# CLAUDE.md — jd-precompta

Documentation durable du projet, à tenir à jour au fil des évolutions. Ce
fichier décrit l'état du projet, pas l'historique des sessions de dev — pas
de récit de debug, pas d'essais abandonnés.

## Objectif et périmètre

Application de précomptabilité pour cabinets comptables (multi-cabinets,
multi-dossiers clients). Un cabinet gère plusieurs dossiers (= clients), pour
chacun desquels elle collecte des pièces, tient une pré-comptabilité
(rapprochement bancaire, écritures brouillon), suit les cotisations
sociales, gère la facturation client, et peut transmettre/recevoir des
factures électroniques via Super PDP.

Client historique : JD Consult (cabinet `jeremy.darnis@gmail.com`), mais
l'appli est conçue multi-cabinets dès l'origine (voir `cabinets`,
`cabinet_admins`).

## État des données (19/09/2026) — à lire avant tout chiffre de ce fichier

**La base ne contient aujourd'hui que des données FICTIVES**, et un seul dossier est vivant :

| Dossier | Créé | État |
|---|---|---|
| `test` (`001c7ed7`) | 16/09/2026 | **le seul qui compte** — 41 pièces, 385 lignes bancaires, 37 documents |
| `deltasoins 10`, `2023`, `DARNIS` | 08-09/2026 | anciens, abandonnés — ne pas s'appuyer dessus |

Conséquences pratiques :

- **Mesurer sur `test`, pas sur l'ensemble des dossiers.** Un chiffre agrégé mélange le dossier
  vivant avec trois bacs à sable abandonnés et ne décrit rien. Plusieurs constats de ce fichier
  datent d'avant cette règle et portent la mention du dossier concerné quand elle est connue.
- **Un défaut trouvé dans un ancien dossier reste un défaut du CODE** — c'est ce qui l'a rendu
  possible qui compte, pas la valeur des données. Mais il ne se raconte pas comme un préjudice
  comptable, et l'urgence qu'on lui prête doit suivre.
- **RGPD.md décrit une exposition à venir, pas constatée** (voir son §4) : tant que les données sont
  fictives, ce registre dit la FORME de ce que l'application stockera, pas ce qu'elle stocke.

## Architecture actuelle

- SPA React consommant directement Supabase (Postgres + Auth + Storage +
  Edge Functions) — pas de backend applicatif séparé. Toute la logique
  métier server-side vit soit dans des policies RLS Postgres, soit dans des
  Edge Functions Deno.
- **Trois profils d'accès** : cabinet (chef de cabinet ou membre d'équipe
  assigné à des dossiers), client (accès restreint à un dossier via un code
  dédié, pas d'auth Supabase classique), super-admin (gestion multi-cabinets
  depuis `SuperAdminPage`).
- **Routing** : `HashRouter` (react-router-dom v7) — nécessaire pour un
  hébergement statique GitHub Pages sans réécriture serveur des routes.
  L'onglet actif d'un dossier fait partie de l'URL (`/dossiers/:id/:tab`),
  pas d'un simple état React, pour que "retour navigateur" après avoir ouvert
  une pièce dans un nouvel onglet revienne au bon endroit.
- **Hébergement** : GitHub Pages, déployé automatiquement par
  `.github/workflows/deploy.yml` (Node 22 → `npm ci && npm run build` →
  `actions/upload-pages-artifact` + `actions/deploy-pages`) à chaque push sur
  `main`. Domaine personnalisé `compta.jdarnis.fr` via `public/CNAME`, d'où
  `base: '/'` dans `vite.config.ts` (pas de sous-chemin).
- **Backend Supabase** : projet `jd-precompta`, id `mztayrhfgtsfjqighlue`,
  région eu-west-1 — séparé du projet `jd-factu` (autre application du même
  utilisateur, ne pas confondre).
- **Migrations** : gérées uniquement via l'outil MCP Supabase
  (`apply_migration` / `list_migrations`) — toujours consulter l'état réel du
  schéma en base (`list_tables`, `execute_sql`) plutôt que de supposer. Le
  dossier `supabase/schema/` en porte un EXPORT (une migration par fichier,
  vérifié par empreinte), pour qu'un schéma reste reconstructible si le projet
  Supabase disparaît : ce n'est pas la source de vérité et il ne s'applique
  pas tout seul. Après toute nouvelle migration, y ajouter le fichier
  correspondant et rejouer le contrôle de dérive de `supabase/schema/README.md`.
- **Edge Functions** (`supabase/functions/`, Deno, un dossier = une
  fonction, déployées via MCP `deploy_edge_function`) :
  - `agent-comptable` — assistant IA (Bedrock/Claude) par dossier, avec
    plafond de coût mensuel par cabinet (alerte + blocage).
  - `create-cabinet`, `delete-cabinet` — cycle de vie d'un cabinet
    (super-admin uniquement).
  - `create-team-member`, `create-client-access` — création de comptes
    (membre d'équipe cabinet / accès client à un dossier).
  - `extract-piece` — OCR + extraction de champs (Textract) sur une pièce
    déposée.
  - `receive-email` — réception d'e-mails entrants (webhook Resend) par
    dossier.
  - `send-email` — envoi d'e-mails sortants (facture, relance de pièces),
    domaine `precompta.jdarnis.fr` via Resend.
  - `superpdp-credentials`, `superpdp-sync`, `superpdp-emit` — facturation
    électronique via Super PDP (voir section dédiée plus bas).

## Stack technique

- React 19 + TypeScript ~6 + Vite 8, `react-router-dom` 7 (`HashRouter`).
- `@supabase/supabase-js` 2.x — client unique exporté par `src/lib/supabase.ts`.
- `exceljs` (génération des packs Excel), `jszip` (packs ZIP), `pdfjs-dist`
  (lecture de PDF côté navigateur, ex. relevés bancaires).
- Lint : `oxlint` (`npm run lint`), pas d'ESLint. Tests : Vitest (`npm test`),
  sur la logique métier pure de `src/lib` uniquement (voir "Tests").
- Aucun framework CSS — styles maison (voir `src/lib/theme.ts`,
  `src/lib/colors.ts` pour la charte graphique personnalisable par cabinet).

## Structure importante du projet

```
src/
  lib/            logique métier partagée, sans JSX (calculs, appels Supabase,
                  formats, export). Point d'entrée du client Supabase :
                  lib/supabase.ts. Gestion centralisée des erreurs d'Edge
                  Function : lib/invokeErreur.ts (voir "Décisions techniques").
  components/     composants UI réutilisables transverses (Layout, modales
                  génériques, icônes, BarreRecherche).
                  BarreRecherche + lib/recherche.ts forment le moteur de
                  recherche commun à tous les écrans qui portent une liste :
                  insensible aux accents et aux majuscules, multi-termes en ET,
                  virgule et point équivalents sur les montants. Un nouvel écran
                  de liste s'y branche plutôt que de refaire un `toLowerCase()`
                  local (qui, lui, ne trouve pas « Télécom » en tapant « telecom »).
  pages/          un composant par écran/route de premier niveau (liste des
                  dossiers, équipe, comptes master, écrans client...).
  pages/dossier/  tous les onglets d'un dossier (Pièces, Factures, Banque,
                  Écritures, Statistiques, Immobilisations, Cotisations,
                  Clôture, Estimation, Financement, Informations, Virements,
                  Accès, Checklist, Documents) + leurs modales associées.
                  Liste et ordre des onglets : src/components/DossierParcours.tsx
                  (type DossierTab) — toute nouvelle vue de dossier doit y être
                  ajoutée pour apparaître dans la navigation et l'URL.
supabase/
  functions/      une Edge Function par sous-dossier, chacune auto-portante
                  (voir "Décisions techniques").
  essais/         essais SQL à REJOUER, pas à lire. restauration.sql : restaure un
                  dossier réel dans un schéma jetable portant les vraies contraintes,
                  compare par empreinte, puis se supprime. rls.sql : rejoue les policies
                  par impersonation des trois profils sur TOUTES les tables du schéma,
                  puis se mute lui-même pour prouver qu'il sait encore échouer.
  schema/         export du schéma, une migration par fichier — voir PLAN_DE_REPRISE.md.
                  Ce n'est PAS la source de vérité : la base l'est, et les migrations
                  continuent de s'appliquer par l'outil MCP.
public/CNAME      domaine personnalisé GitHub Pages (compta.jdarnis.fr).
PLAN_DE_REPRISE.md  quoi faire le jour où quelque chose a disparu. Dans le dépôt Git et
                  pas dans Notion ni dans l'application : un plan de reprise hébergé sur
                  ce dont il faut se passer n'est pas un plan de reprise.
.github/workflows/deploy.yml   déploiement continu sur push vers main.
```

## Conventions de développement

- **Système visuel = `src/index.css` seul, et aucune couleur d'accent en dur** : la charte par
  cabinet (`lib/branding.ts`) ne remplace en inline sur `:root` que `--color-primary`, `-hover` et
  `-light`. Toute nuance dérivée (fond teinté, halo de focus, ombre colorée, survol) doit donc être
  calculée depuis `--color-primary` avec `color-mix()` — voir les tokens `--tint-primary`,
  `--tint-primary-strong`, `--ring-primary`, `--glow-primary`, `--wash-primary` — pour suivre la
  couleur de chaque cabinet en clair comme en sombre. Fonds plats (pas de dégradés sur les boutons/
  pastilles), profondeur par ombres douces à deux couches (`--shadow-xs/sm/md/lg`), rayons
  `--radius-xs/sm/lg` + `--radius`, transitions `var(--duree) var(--ease)`. Piège connu : jamais de
  `backdrop-filter`/`filter`/`transform` sur `.sidebar` (ancêtre d'une nav en `position: fixed`) —
  ça en fait la référence de positionnement et la barre du bas remonte se coller à celle du haut.
- **Tableaux de bord = widgets partagés + grille bento** (`src/components/widgets/`) : `KpiTile`
  (libellé, valeur en chiffres proportionnels, delta signé, `Sparkline` 12 points), `ProgressRing`,
  `MonthlyBars` (encaissements en accent, décaissements en gris — jamais le rouge de danger en
  couleur de série ; légende obligatoire ; infobulle au survol), `Widget` (carte titrée avec action),
  `Avatar` (initiales sur teinte du cabinet, une seule couleur). Disposition en `.bento` 12 colonnes
  (`.span-3/4/5/6/7/8/12`, une colonne sur mobile, tuiles KPI deux par ligne). Règles du guide de
  visualisation : le texte garde sa couleur de texte, le statut se lit à une pastille (`.kpi-dot`,
  `.check-dot`) ; couleurs de statut réservées, jamais réutilisées comme série. Police par défaut
  Manrope (Inter en repli). En-tête de dossier en "cockpit" (`.cockpit`, avatar + badges + sélecteur
  d'exercice à droite). Chargements en squelettes (`.skeleton*`), jamais un simple "Chargement…" sur
  un tableau de bord. Vérification visuelle : `scratchpad/captures/rendu.tsx` (react-dom/server sur
  les vrais composants, bundlé par rolldown) + `vitrine.js` (Playwright, PC 1280 / mobile 390, clair
  et sombre) — à rejouer après toute modification de `index.css`.
- **Exercice partagé entre onglets** (`src/context/AnneeContext.tsx`, `useAnnee()`) : Pièces, Banque,
  Écritures, Statistiques et Clôture lisent le même exercice sélectionné, choisi une fois dans le
  sélecteur de l'en-tête du dossier (voir `DossierDetail.tsx`, `SelecteurExerciceEntete`) plutôt que
  chacun son propre filtre local — toute nouvelle vue dont un total dépend de l'exercice devrait
  rejoindre ce même contexte plutôt que réinventer un `useState<ValeurAnnee>` local. Le filtre "sans
  date" (propre aux pièces, sans équivalent sur un mouvement bancaire ou une écriture) reste un état
  local à `PiecesTab`, hors de ce contexte.
- **Français partout** : noms de variables/fonctions, commentaires, libellés
  UI, messages d'erreur utilisateur. Les commentaires expliquent le
  *pourquoi* (contrainte métier, bug évité, choix délibéré), jamais un simple
  paraphrasage du code.
- **Mutations optimistes** côté UI quand c'est simple et sûr (ex. toggle
  assujetti TVA dans `DossierDetail.tsx`) : on met à jour l'état local
  immédiatement, on annule et on affiche l'erreur si l'appel Supabase échoue.
- **Aucun appel réseau externe silencieux** : toute action qui interroge une
  API tierce (SIRENE, Super PDP, IA) est déclenchée par un clic explicite de
  l'utilisateur, jamais automatiquement au chargement d'un écran.
- **Rien n'est jamais validé/importé automatiquement** : un document importé
  (dépôt manuel, import en masse, synchronisation Super PDP) arrive toujours
  au statut "à valider" ; la validation reste un geste humain.
- **Une facture validée est figée** : ses montants et son identité émetteur
  (SIRET, adresse) sont un instantané au moment de la validation et ne sont
  jamais recalculés rétroactivement si le dossier change ensuite. Pour
  corriger une facture déjà validée, on émet un avoir puis une nouvelle
  facture — jamais une modification en place.
- **Détection de doublons par hash de contenu** (SHA-256 du fichier, pas du
  nom) avant tout dépôt de pièce/document, pour repérer un même fichier
  déposé deux fois. **Elle a un angle mort, par construction** : deux EXPORTS
  du même document ont des octets différents — voir la règle sur
  `doublonsTexte` plus bas, et l'empreinte du TEXTE qui la ferme.
- Style de code des Edge Functions : fichiers plats, une fonction
  `Deno.serve`, helpers locaux au fichier (voir "auto-porteur" ci-dessous).

## Décisions techniques déjà prises

- **RLS multi-cabinets** : tables `cabinet_admins` (qui dirige quel cabinet),
  `dossier_assignations` (quel membre d'équipe a accès à quel dossier), et
  fonctions `security definer` `est_chef_du_cabinet()`, `admin_du_dossier()`,
  `admin_du_cabinet()`, `is_super_admin()`. Chacune de ces fonctions inclut
  `is_super_admin()` dans son propre OR pour que le super-admin ait toujours
  accès. Convention systématique pour toute nouvelle table métier rattachée à
  un dossier : une policy RLS unique `FOR ALL` basée sur
  `admin_du_dossier(dossier_id)`. Toute nouvelle table doit être vérifiée par
  impersonation réelle (JWT de test via `set_config`) avant d'être considérée
  fiable, jamais seulement relue. Une table sans colonne `dossier_id` propre
  (enfant d'une autre table métier) remonte au parent dans sa policy :
  `admin_du_dossier((select dossier_id from parent where parent.id = enfant.parent_id))`.
  Exemple vivant : `mouvements_cca` sous `comptes_courants_associes`. (Ce
  motif venait à l'origine de `pack_pieces`, supprimée depuis — voir
  "Problèmes connus".)
- **Une policy sans clause `to` s'applique à `public`, donc à `anon`.** C'est la
  règle la plus coûteuse à ignorer du schéma, parce qu'elle ne se voit pas en
  relisant : `using (dossier_id is null or admin_du_dossier(dossier_id))` a l'air
  de dire « partagé par tout le cabinet » et dit en réalité « lisible par tout
  Internet muni de la clé publique ». Deux policies l'écrivaient — `categories` et
  `natures_immobilisation` — et un visiteur non connecté lisait les 10 catégories
  comptables et les 8 natures du cabinet. Relues plusieurs fois sans que personne
  ne voie la clause manquante ; il a fallu l'EXÉCUTER pour la voir (migration
  `categories_et_natures_reservees_aux_connectes`). Toute policy porte donc
  désormais son `to authenticated` explicite, et `supabase/essais/rls.sql` le
  vérifie sur l'intégralité du schéma.
- **Les policies se REJOUENT, elles ne se vérifient pas une fois pour toutes.**
  Chaque policy était éprouvée par impersonation à sa création, puis plus rien :
  une migration pouvait en défaire une sans qu'aucun signal n'existe.
  `supabase/essais/rls.sql` rejoue les trois profils (anonyme, authentifié
  rattaché à rien, client) sur toutes les tables, plus cinq tentatives d'écriture.
  Trois choix le rendent utile plutôt que décoratif : la boucle part de `pg_class`
  et non d'une liste tenue à la main, donc **une table ajoutée demain sans policy
  est attrapée sans que personne ait à y penser** ; les écritures d'essai sont
  annulées par sous-transaction PL/pgSQL (`raise exception` dans un bloc
  `BEGIN … EXCEPTION`, qui défait l'écriture mais laisse les VARIABLES intactes),
  donc il tourne sur la base réelle sans y laisser de trace ; et un refus doit
  porter le SQLSTATE `42501` nommément, sinon une colonne mal orthographiée
  échouerait en `42703` et passerait pour un refus de policy.
  **Le harnais est lui-même testé par mutation**, et ce n'est pas du zèle : si
  `set local role` ne prenait pas, tous les comptes rendraient zéro et le fichier
  afficherait « 0 en faute » sur une base grande ouverte — la panne qui ressemble
  exactement au succès. Sept mutations (contrôles rejoués sous le super-admin,
  liste d'exceptions retirée) doivent virer au rouge ; un contrôle qui reste vert
  est un contrôle à reprendre, même quand les invariants sont tous verts.
- **Dans le stockage, le premier segment du chemin EST le dossier.** Les policies de
  `storage.objects` font toutes `(storage.foldername(name))[1]::uuid` et passent ce
  résultat à `admin_du_dossier` ou le comparent aux `memberships`. Conséquence peu
  intuitive : un chemin dont le premier segment n'est pas un UUID ne masque pas une
  ligne, **il fait lever le cast** — donc casse la lecture du seau pour tout le monde,
  d'un coup. C'est le contrôle S6 de `rls.sql`, qui a l'air de ne rien vérifier.
- **Une suppression de fichier ne se teste PAS en SQL.** Le trigger
  `protect_objects_delete` (BEFORE DELETE → `storage.protect_delete`) refuse toute
  suppression SQL directe, pour TOUT LE MONDE, *et avec le SQLSTATE 42501* — celui d'un
  refus de policy. Un essai de suppression est donc indiscernable d'un refus RLS : il
  passerait au vert avec une policy grande ouverte. C'est le test de MUTATION qui l'a
  démasqué, le contrôle étant vert alors que sa mutation refusait de mordre. Ce qui est
  gardé à la place est une lecture du catalogue (la policy existe-t-elle encore, avec son
  prédicat), plus faible et annoncée comme telle ; le vrai chemin passe par l'API Storage,
  qu'un script SQL ne peut pas appeler. Voir RGPD.md §8.6.
- **Une table que le CLIENT écrit sort de la convention `FOR ALL`.** Le client
  a un `membership`, pas `admin_du_dossier` : la policy doit donc lister ses
  droits un par un, et surtout pas lui ouvrir la table entière. `piece_commentaires`
  est le cas de référence, et son `WITH CHECK` porte trois garanties qu'aucune
  relecture ne remplace : l'auteur est forcément `auth.uid()`, `origine = 'cabinet'`
  équivaut exactement à `admin_du_dossier(dossier_id)` (un client ne peut pas
  signer « cabinet »), et la cible doit appartenir au dossier annoncé — sans quoi
  un `dossier_id` porté en propre serait une porte ouverte. Les neuf cas ont été
  vérifiés par impersonation réelle avant livraison.
- **Une déclaration datée ne se réécrit pas.** `piece_commentaires` n'a AUCUNE
  policy `UPDATE`, pour personne : un commentaire est une parole prononcée à un
  moment, la réécrire après coup lui retire sa valeur devant un contrôle. On se
  corrige en ajoutant un commentaire, pas en effaçant le précédent. La
  suppression reste au cabinet, pour retirer un hors-sujet — pas pour réécrire
  l'histoire.
- **Edge Functions auto-porteuses** : aucun import depuis `src/` — aussi
  petites et pures soient certaines fonctions (ex. calcul de montants de
  ligne de facture, constantes tarifaires IA), elles sont dupliquées entre
  `src/lib/` et l'Edge Function correspondante plutôt que partagées, pour
  garder chaque fonction déployable indépendamment.
- **Gestion des erreurs d'Edge Function (`src/lib/invokeErreur.ts`)** :
  `supabase.functions.invoke()` (librairie `@supabase/functions-js`) lève une
  `FunctionsHttpError` sur toute réponse non-2xx **avant** d'avoir lu le
  corps — `data` vaut donc toujours `null` sur erreur, seul
  `error.context` (la `Response` brute, jamais consommée) contient le corps
  JSON réel renvoyé par la fonction (`{ error: "..." }`). Toujours passer par
  `extraireErreurFonction(error, repli)` pour afficher le vrai message
  d'erreur à l'utilisateur — ne jamais supposer que `data?.error` sera
  peuplé en cas d'échec.
- **Et cette fonction-là n'avait AUCUN test**, corrigé le 20/09/2026. C'est le point de passage
  unique de tous les messages d'erreur d'Edge Function — treize appels y mènent — et son absence de
  couverture était coûteuse pour une raison précise : **une régression n'y casse rien de visible**.
  Elle fait retomber chaque écran sur son repli, qui est plausible. C'est mot pour mot le défaut
  qu'elle a été écrite pour corriger, et qui avait vécu depuis le début du projet sans être vu.
  Dix tests, six mutations tuées, dont deux cas que la relecture ne suggère pas : une `Response` ne
  se lit QU'UNE FOIS (déjà consommée, `.json()` lève — c'est ce que le `catch` doit absorber), et le
  corps doit primer sur le message de l'`Error` qui le porte, `FunctionsHttpError` n'annonçant que
  « Edge Function returned a non-2xx status code ».
  `invokeErreur.ts` n'important pas `supabase.ts`, il se teste sans faux client, avec de vraies
  `Response` — l'exception qui confirme la règle du module de calcul découplé.
- **ET LE MÊME DÉFAUT VIVAIT SUR L'AUTRE PORTE, QUARANTE-CINQ FOIS** (`src/lib/messageErreur.ts`,
  20/09/2026). **Une erreur Postgrest n'est PAS une instance d'`Error`.** Le fait est dans la source
  de `@supabase/postgrest-js` et nulle part ailleurs : sur le chemin NON levant — celui qu'utilise
  tout ce dépôt, `const { error } = await supabase…` — la bibliothèque fait `error = JSON.parse(body)`.
  Ce qu'on reçoit est un OBJET NU `{ message, details, hint, code }`. La classe
  `PostgrestError extends Error` existe bel et bien, ce qui rend le piège parfait, mais elle n'est
  construite que sur les branches `shouldThrowOnError`, que ce dépôt n'active nulle part.
  Donc `catch (err) { err instanceof Error ? err.message : repli }` — quarante-cinq sites, vingt-trois
  fichiers — jetait systématiquement la raison. « new row violates row-level security policy »,
  « duplicate key value violates unique constraint », « violates foreign key constraint » : rien de
  tout cela n'est jamais arrivé sous les yeux d'un opérateur, qui lisait « Une erreur est survenue. »
  sans pouvoir savoir s'il devait corriger une saisie, appeler l'administrateur ou réessayer.
  C'est MOT POUR MOT le défaut qu'`extraireErreurFonction` avait corrigé au-dessus, revenu par
  l'autre porte, et invisible pour la même raison : **une régression n'y casse rien de visible**,
  elle fait retomber chaque écran sur un repli plausible.
  `messageErreur(erreur, repli)` regarde ce que la valeur PORTE et non ce dont elle hérite, donc
  traite les deux formes par une seule branche — `message` est une propriété propre d'une `Error`
  comme d'un objet nu, et les distinguer par `instanceof` est précisément l'erreur qu'on corrige.
  Il vérifie le type (`{ message: 42 }` retombe sur le repli) et refuse un message vide.
  `details`/`hint` ne sont PAS repris : décision écrite comme à rouvrir si un message de contrainte
  se révèle indéchiffrable sans eux, pas avant.
  **Trouvé en écrivant un test d'écran, pas en relisant** — et le premier réflexe était FAUX : j'ai
  cru le faux client infidèle parce qu'il rendait un objet nu. C'est la source de la bibliothèque qui
  a tranché, contre le code de production.
  **ET LA RÈGLE NE RESTE PAS ICI : elle est devenue un test.** `erreursSupabase.test.ts` interdit le
  ternaire fautif dans TOUTE source de production, **sans aucune exception** — il n'existe pas de cas
  où cette forme soit correcte. `if (err instanceof Error)` reste permis ; ce qui est interdit, c'est
  de faire dépendre le MESSAGE AFFICHÉ de l'héritage. Son auto-contrôle est un défaut PLANTÉ dans une
  source synthétique, avec deux cas voisins qu'il ne doit PAS attraper — « le scanner rend zéro » et
  « le scanner est aveugle » se ressemblent trop, c'est la panne qui a laissé passer trois versions
  du scanner de lectures paginées. Il a d'ailleurs attrapé une vraie régression dans la foulée : un
  `git checkout --` destiné à défaire une mutation avait aussi défait le correctif non commité du
  même fichier.
  Cinq mutations mordent sur le module, trois sur le scanner. La première est le défaut d'origine
  replanté (exiger `instanceof Error`) : **un test qui n'aurait posé que de vraies `Error` serait
  resté vert avec le défaut entier**, et c'est exactement ce qui l'a laissé vivre depuis le début.
- **Extraction de champs : le modèle CITE, il ne calcule jamais** (`src/lib/extractionChamps.ts`,
  20/09/2026, chantier EN COURS). `AnalyzeExpense` coûte 10 $/1000 pages et fait deux choses : lire
  le texte, et ÉTIQUETER des champs. La seconde est si irrégulière — `INVOICE_RECEIPT_DATE` sur
  4 factures sur 22 d'un même fournisseur — que chaque champ a dû recevoir un repli sur texte brut,
  et c'est ce repli qui travaille. `DetectDocumentText` (OCR seul) coûte ~1,50 $/1000 pages.
  Le contrat : le modèle rend la chaîne TELLE QU'IMPRIMÉE (`"1 234,56 €"`), jamais une valeur
  composée. Le code vérifie qu'elle figure dans le texte source, puis la passe aux analyseurs déjà
  éprouvés. Une valeur inventée n'est nulle part dans le texte, donc rejetée — et le fondement est
  une mesure : 39 pièces sur 39 portant un montant l'écrivent mot pour mot dans leur propre texte.
  **L'asymétrie des deux passes de vérification est le cœur du module** : blancs normalisés et casse
  ignorée partout (le modèle recopie avec une espace ordinaire ce que la facture imprime en
  insécable) ; blancs ENTIÈREMENT retirés pour les seuls montants (un séparateur de milliers est de
  la présentation, et les chiffres restent tous présents et dans l'ordre) ; jamais sur le tiers, où
  la soudure de deux mots fabriquerait une raison sociale absente. Les accents ne sont jamais
  aplatis — c'est la frontière entre « recopier » et « ressembler ».
  **MESURÉ SUR LES 41 TEXTES RÉELS** (`supabase/functions/evaluer-extraction`, Edge Function parce
  que ces textes portent des noms de patients et ne doivent pas remonter dans une conversation) :
  209 citations, **zéro invention**, zéro erreur de montant. Les 3 désaccords de date sont
  l'extraction ACTUELLE qui se trompe — sur deux pièces la date stockée est ABSENTE du document ;
  sur la troisième le document porte 2024 ET 2028, et l'extraction a retenu l'impossible.
  **ET LA MESURE A TROUVÉ UN DÉFAUT DANS LE PROMPT LUI-MÊME** : sans champ `devise`, les quatre
  factures en dollars du dossier auraient écrit 24 dans `montant_ttc` au lieu de `montant_devise`,
  soit 16 % d'erreur en silence sur des charges qui partent en 2035. Les colonnes existaient, le
  contrat les ignorait.
  **Le garde-fou de duplication a échoué d'abord, et c'est la leçon à retenir** : `devise` ajoutée
  d'un seul côté a laissé le test VERT, sa batterie étant écrite à la main et ne portant aucun cas
  avec cette clé. Les deux copies « étaient d'accord » sur des questions qu'on ne leur posait pas —
  la panne que ce dépôt connaît déjà sous un autre nom. Le garde compare désormais les deux listes
  de champs et DÉRIVE ses cas de `CHAMPS_CITES`.
  **BRANCHÉ dans `extract-piece` le 21/09/2026**, et la SÉPARATION vaut plus que l'économie :
  l'étage 1 produit du texte, l'étage 2 en tire des champs, et les deux ne se connaissent que par une
  chaîne de caractères. Elle avait été motivée en partie par la marche 2, écartée depuis — et elle
  tient sans elle : c'est cette couture qui a rendu la mesure de coût poste par poste possible, et
  qui garde le fournisseur d'OCR remplaçable si la question revient.
  **L'étage 2 est BEST-EFFORT, l'étage 1 non** : Bedrock indisponible, quota atteint, JSON malformé,
  l'extraction continue sur le seul texte OCR et rend la classification, la lecture 2035,
  l'échéancier de cotisation et la date par repli. Perdre le tiers et les montants coûte une saisie ;
  perdre le reste coûte le document.
  **La confiance rendue devient honnête.** Elle était la moyenne des confiances de champs Textract,
  qui mesure la LISIBILITÉ — les onze pièces à TVA démontrablement fausse du corpus étaient toutes en
  « haute ». Elle est maintenant le PIRE de trois plafonds qui ne mesurent pas la même chose :
  lisibilité des blocs OCR, cohérence des montants entre eux (la seule qui juge le résultat), et
  citation. Un rejet de citation est une invention ATTRAPÉE : il coûte un cran, jamais « basse » —
  la plupart des rejets portent sur un champ simplement absent du document, et les traiter en faute
  grave noierait le signal.
  **La devise est demandée au modèle mais PAS rendue**, et ce n'est pas un oubli : la règle qui
  transforme « $ » en « USD » vit dans `src/lib/devises.ts`, et `montantsPourPiece` la lit déjà sur
  le texte OCR qui remonte jusqu'à lui (voir le commentaire de `MontantsLus.texte_ocr`, qui refuse
  explicitement cette seconde copie). On la demande quand même parce qu'un modèle à qui l'on rappelle
  que les montants portent une monnaie cite mieux les montants.
  **L'usage de tokens est JOURNALISÉ, pas compté par cabinet** — décision assumée. La fonction ne
  reçoit que des OCTETS : aucun `dossier_id` à quoi rattacher ce coût sans changer son contrat et ses
  trois appelants. Le journal est le morceau irréversible (`query_logs`) — des tokens non journalisés
  ne se retrouvent jamais, un plafond s'ajoute quand on veut. Ce plafond devra être **distinct** de
  celui de l'assistant comptable : partagé, 5 000 documents par mois feraient sauter le plafond de
  l'assistant sans que personne comprenne pourquoi.
  **Le garde de duplication couvre désormais les DEUX copies** (`evaluer-extraction` et
  `extract-piece`) et compare aussi les PROMPTS au caractère près. Un prompt qui dérive demande autre
  chose au modèle, et aucun test de comportement ne peut le voir — `verifierCitations` vérifie des
  citations, pas la question qui les a produites.
  **Déployée le 21/09/2026 (version 43), et la VÉRIFICATION annoncée ici a mordu du premier coup** :
  le dépôt réel a rendu 500 sur la policy IAM, pas sur le code (voir « un déploiement n'est pas une
  autorisation »). Une fois la policy corrigée, la chaîne complète est passée le jour même — et la
  mesure a divisé par quatre l'économie annoncée, l'étage 2 reprenant les deux tiers de ce que
  l'étage 1 fait gagner (chiffres dans « Fonctionnalités actuellement en cours »).
- **Le balayage des paramètres par défaut a rendu un résultat NÉGATIF pour tous les autres**
  (20/09/2026) : sept fonctions exportées de `src/lib` en portent un, et `ordreSuppression`,
  `baremeDeLAnnee`, `soldesDuPdf`, `capitalRestantDu` et `empruntActif` exercent déjà le leur. Seul
  `extraireErreurFonction` était à découvert, et pas seulement sur son défaut : sur tout.
- **HAIKU 4.5 CITE AUSSI FIDÈLEMENT QUE SONNET 4.6, POUR TROIS FOIS MOINS CHER** (mesuré le
  21/09/2026 sur les 43 textes réels du dossier `test`, les deux modèles le même jour, même prompt,
  mêmes documents). C'est la mesure que ce fichier exigeait avant tout changement de modèle — « en
  changer invaliderait ce feu vert, donc c'est un choix à rouvrir avec une nouvelle mesure, jamais
  en passant ».
  **Zéro rejet des deux côtés** : aucune des 216 citations de Sonnet ni des 215 de Haiku n'était
  absente du texte source. La couverture est à égalité — Haiku trouve un TTC de plus, Sonnet deux
  TVA de plus, et la TVA est le seul des six champs à porter un repli (`tvaDepuisTexteBrut`) ET à
  se recalculer par soustraction dans `resoudreMontants`, donc c'est le moins coûteux à manquer.
  **LES SEPT DÉSACCORDS SONT DES VARIANTES DE FORME, PAS DE VALEUR** — vrai, mais **l'exemple choisi
  pour l'illustrer était FAUX, et il cachait un défaut de production** (corrigé le 21/09/2026, voir
  « une contrainte justifiée par un appelant » plus bas). Il était écrit ici que
  `« mercredi 23 juillet 2025 »` contre `« 23/07/2025 »`, c'était « deux branches de `parseDate`,
  même date ». EXÉCUTÉ, `parseDate` rend `null` sur le premier et `2025-07-23` sur le second : ce
  n'était pas une variante de forme, c'était une date PERDUE — et celle de Sonnet, le modèle en
  place. Écrit par relecture du code, démenti par une exécution.
  Les autres tiennent, et ont été exécutés cette fois : `« $24.00 »` contre `« $24.00 USD »`
  (`parseAmount` rend 24 dans les deux cas), `« 20/12/24 10:47 »` contre `« 20/12/24 »`
  (`2024-12-20` des deux côtés), et trois fois `« $ »` contre `« USD »` sur un champ **demandé mais
  pas rendu**. Aucune valeur divergente sur aucun champ qui part en comptabilité. Le TTC cité se
  retrouve dans le montant stocké 37/37 pour Sonnet, **38/38 pour Haiku**.
  **Une fois `parseDate` corrigé, les deux modèles rendent 42 dates citées, 0 perdue, 38 identiques
  à la date stockée** — l'égalité annoncée est donc vraie, mais elle ne l'était pas encore au moment
  où elle a été écrite.
  **C'est exactement ce que le contrat de citation prédit** : le modèle DÉSIGNE une chaîne, les
  analyseurs éprouvés l'interprètent. Un modèle plus petit choisit parfois une autre forme de la
  même chose — et la normalisation vit dans du code testé, pas dans le modèle. C'est cette
  séparation qui rend le modèle interchangeable, et la mesure le confirme plutôt que de l'espérer.
  **Le coût, aux tarifs première partie** (Bedrock ayant sa propre grille, c'est l'ordre de grandeur
  et non le centime) : 6,11 $ contre 2,04 $ les 1 000 documents pour l'étage 2, soit **3,0×**. Sur
  la chaîne complète, le rapport avec l'ancien `AnalyzeExpense` passerait de **1,8–2,4× à 3,5–4,2×**.
  **LE POINT BLOQUANT ÉTAIT QUE LA MESURE NE TOURNAIT PAS OÙ TOURNE LA PRODUCTION — LEVÉ LE
  21/09/2026, ET PAR UNE MESURE PLUTÔT QUE PAR UNE LECTURE DE TABLEAU DE BORD.**
  `evaluer-extraction` tournait en `eu-west-1` en dur, `extract-piece` en `AWS_REGION ?? eu-central-1` :
  la disponibilité du profil d'inférence était donc prouvée dans la région de la MESURE, pas dans
  celle de la PRODUCTION — « un déploiement n'est pas une autorisation » rejoué sur une autre
  ressource. **Ce n'est pas une question de forme** : la disponibilité d'un modèle Bedrock est PAR
  RÉGION, et `agent-comptable` câble `eu-west-1` en dur précisément parce que son modèle n'y était
  proposé que là.
  Le harnais lit désormais le MÊME secret que la production et REND la région qu'il résout, ce qui
  répond aux deux questions d'un coup : **`AWS_REGION` vaut `eu-central-1`**, et
  `eu.anthropic.claude-haiku-4-5-20251001-v1:0` y répond (1 pièce, 0 échec, 0 rejet, citations
  rendues). Un troisième test garde que les deux fonctions retombent sur le même repli — une mesure
  qui dérive de la production cesse de mesurer la production, en silence.
  **Appelé avec `limite: 0`, ce harnais lit la région sans facturer un seul token**, la boucle ne
  tournant sur aucune pièce : c'est le moyen le moins cher de reposer la question le jour où le
  secret change, et il ne demande d'accès à aucun tableau de bord.
  **BASCULÉ EN PRODUCTION LE 21/09/2026** (`MODELE_CITATION`), la mesure ayant été rejouée EN ENTIER
  dans la région de la production avant d'y toucher : 43 textes, 0 échec, **216 citations, 0 rejet** —
  le compte exact de Sonnet, et un de plus que la même mesure en `eu-west-1`.
  **DEUX EXÉCUTIONS DU MÊME MODÈLE DIFFÈRENT AUTANT QUE DEUX MODÈLES DIFFÉRENTS, et c'est le résultat
  le plus utile de la journée** : Haiku contre lui-même (deux régions) rend 5 écarts de champ sur
  2 pièces ; Sonnet contre Haiku en rend 16 sur 10, dont 9 sont de la COUVERTURE (l'un cite, l'autre
  rend `null`) et 7 de vrais désaccords. Quatre des cinq écarts « du modèle contre lui-même » sont
  les mêmes variantes de dollars qui comptaient comme « désaccord entre modèles ». Une bonne part de
  ce qu'on attribuait au choix du modèle est le bruit d'exécution de la tâche elle-même — ce qui
  **abaisse** ce qu'un palmarès de modèles peut prouver, et **relève** d'autant ce que fait le
  contrat de citation.
  **Ce que la bascule change RÉELLEMENT, champ par champ** : 3 désaccords vrais, tous des variantes
  de forme de la même valeur (deux dates, une devise — sur un champ qui n'est même pas rendu), et une
  couverture strictement à égalité, 4 champs gagnés contre 4 perdus. **Vérifié en exécutant les vrais
  analyseurs sur les citations réelles**, pas en les lisant : c'est cette vérification-là qui a trouvé
  le défaut de `parseDate` ci-dessous, et démenti une phrase de ce fichier.
  **Le garde qui manquait** : `extractionChampsCopie.test.ts` comparait le prompt au caractère près et
  `verifierCitations` par exécution, mais pas le MODÈLE — la troisième chose qui décide de ce qui est
  mesuré. Le défaut d'`evaluer-extraction` doit nommer `MODELE_CITATION` ; passer un `modele` reste la
  raison d'être du harnais, mais ce qu'il fait SANS argument doit rester « mesurer la production ».
  Trois mutations mordent.
  **Pourquoi un modèle plus petit est SÛR ici, et ce n'est pas de la confiance** : le contrat de
  citation BORNE le coût d'une erreur. Un modèle plus faible cite MOINS — ce qui coûte une saisie —
  mais ne peut pas faire entrer une valeur composée dans une comptabilité, `verifierCitations`
  refusant ce qui n'est pas dans le texte. C'est cette séparation qu'il faut revérifier avant de
  changer de modèle, pas seulement le palmarès du modèle.
  **Deux identifiants refusés au passage, à ne pas rechercher** : les formes courtes
  `eu.anthropic.claude-haiku-4-5` et `eu.anthropic.claude-sonnet-5` rendent une `ValidationException`
  (« The provided model identifier is invalid »). Seule la forme datée complète passe, alors même
  que `eu.anthropic.claude-sonnet-4-6` fonctionne sans suffixe — les deux conventions coexistent.
- **LA MARCHE 2 (OCR LOCAL) EST ÉCARTÉE — décision de l'utilisateur, 21/09/2026, prise sur la
  mesure.** Le chantier était cadré et son architecture arrêtée : un service sur un mini-PC
  interrogeant Supabase (jamais l'inverse — aucun port ouvert, aucun tunnel, rien à refaire quand
  l'IP de la box change), avec un débordement AWS PERMANENT pour les pièces que personne n'a lues.
  Ce qui l'a arrêté n'est pas une difficulté technique, c'est le chiffre : **sortir l'OCR d'AWS ne
  retire que 27 à 36 % du coût** d'une extraction (0,0030 $ sur 0,0109 $ pour une facture courte,
  0,045 $ sur 0,124 $ pour un document dense) — tout le reste est l'étage 2, qui ne bouge pas. Un
  quart de la facture ne paie pas une machine de bureau devenue dépendance du chemin de production.
  **Et le RGPD ne penchait pas du côté qu'on croyait** : retirer AWS du registre ferait vivre les
  pièces — donc des noms de patients — sur une machine de bureau, ce qui DÉPLACE la question
  (chiffrement du disque, accès physique, sauvegarde) au lieu de la supprimer. Textract tourne déjà
  en région européenne, et c'est un test qui le garde.
  **Rien n'est à défaire** : aucun code n'avait été écrit. La séparation des deux étages, motivée en
  partie par ce chantier, tient sur ses propres mérites — c'est elle qui a rendu la mesure de coût
  possible, et elle garde le fournisseur d'OCR remplaçable le jour où la question reviendrait.
  **Ce qui la rouvrirait, et c'est la seule chose utile à retenir** : un VOLUME qui rende la facture
  d'extraction matérielle (à 0,12 $ le document dense, il y faut des milliers de pages par mois), ou
  une exigence CLIENT de ne pas confier les pièces à un sous-traitant. Jamais une intuition de coût —
  la facture AWS tranche, et elle est désormais lisible poste par poste dans `query_logs` par la
  ligne `[extract-piece] citation …`.
  **ET LE CHIFFRE QUI A DÉCIDÉ BOUGERAIT SI LE MODÈLE DE CITATION CHANGEAIT** — écrit ici parce que
  taire une conséquence défavorable à une décision qu'on vient de prendre est la façon la plus facile
  de la rendre fausse. Les 27 à 36 % supposent Sonnet 4.6 à l'étage 2. Avec Haiku 4.5 (voir la mesure
  ci-dessus), l'OCR devient **53 à 63 %** du coût d'une extraction, et l'économie que la marche 2
  apporterait double. Ce qui ne change PAS : le RGPD ne penche toujours pas de ce côté, et une
  machine de bureau reste une dépendance du chemin de production. La décision tient donc sur ses
  autres pieds — mais son pied budgétaire serait deux fois moins solide, et c'est à savoir le jour
  où la question se rouvre.
- **N° de TVA intracommunautaire français** calculé déterministiquement à
  partir du SIREN (formule CGI art. 286 ter : `clé = (12 + 3×(SIREN mod 97))
  mod 97`, puis `FR` + clé 2 chiffres + SIREN) plutôt que demandé comme champ
  utilisateur — voir `numeroTvaFr()` dans `superpdp-emit`. Omis entièrement
  sur une facture dont toutes les lignes sont exonérées/franchise en base.
- **Hébergement GitHub Pages** retenu malgré un signalement Google Safe
  Browsing rencontré une fois (probablement lié au pool d'IP mutualisé de
  Pages) — remédié via Google Search Console (vérification de domaine par
  TXT DNS chez le registrar, Infomaniak) plutôt qu'une migration
  d'hébergeur ; à reconsidérer (Cloudflare Pages/Vercel) seulement si le
  signalement se reproduit.

## Services externes et MCP utilisés

- **Supabase** (MCP `Supabase`) — base de données, auth, storage, edge
  functions du projet `mztayrhfgtsfjqighlue`. Toujours vérifier le schéma
  réel (`list_tables`, `execute_sql`) avant de supposer une structure.
- **Resend** (MCP `Resend`) — envoi (`send-email`) et réception
  (`receive-email`) d'e-mails. Domaine `precompta.jdarnis.fr` déjà vérifié en
  envoi et réception ; `RESEND_API_KEY` déjà configuré comme secret Supabase.
- **Super PDP** (`https://www.superpdp.tech`, API `api.superpdp.tech`) —
  plateforme de dématérialisation partenaire agréée DGFiP pour la facturation
  électronique (réception des factures fournisseurs et émission des factures
  de vente au format Cross Industry Invoice / EN16931 / Peppol). Une
  application OAuth Super PDP est rattachée à une seule entreprise/SIRET :
  chaque dossier a ses identifiants propres (`superpdp_credentials`), jamais
  partagés. Cet environnement ne peut pas atteindre `api.superpdp.tech`
  directement (sortant bloqué) — tout diagnostic passe par les logs de
  production (MCP `query_logs`, sources `function_logs`/`edge_logs`) après
  un test réel effectué par l'utilisateur.
- **API SIRENE** — recherche de code NAF/profession à partir d'un SIRET
  (`src/lib/sirene.ts`), déclenchée uniquement à la demande.
- **Bedrock (Claude)** — moteur de l'assistant comptable (`agent-comptable`),
  avec suivi de coût par tokens et plafond configurable par cabinet.
- **GitHub Actions** — CI/CD de déploiement (voir `.github/workflows/deploy.yml`).

## Contraintes de sécurité et RGPD

- **Le registre RGPD vit dans `RGPD.md`** — traitements, sous-traitants et régions, durées de
  conservation, droits des personnes, et ce qui reste à décider. Trois faits mesurés qui gouvernent
  le reste : les données de patients sont dans les FICHIERS, pas dans les tables (sur 41 textes OCR
  conservés, zéro NIR et zéro date de naissance) ; le texte OCR est une copie dérivée SANS durée
  légale propre, donc le seul levier de minimisation réellement disponible ; et aucune pièce n'a
  encore dépassé l'obligation de 10 ans, la première purge possible n'étant pas avant 2033.
- **Où partent les données quand elles quittent Supabase, c'est un test qui le dit.**
  `edgeFunctionsRegions.test.ts` lit la vraie source des Edge Functions et refuse toute région AWS
  hors UE — Textract comme Bedrock — et exige que les deux clients Textract d'`extract-piece`
  partagent la même région. Ce que ce test NE peut pas garder : le secret `AWS_REGION`, qui l'emporte
  sur le repli du code et qui peut changer sans qu'aucun fichier du dépôt ne bouge. **Sa valeur est
  désormais MESURÉE et non supposée — `eu-central-1`, le 21/09/2026** : `evaluer-extraction` résout
  le même secret et le REND, donc un appel avec `limite: 0` le relit à tout moment sans facturer un
  token. La moitié gouvernée par le code est gardée, l'autre se remesure en un appel plutôt que de
  reposer sur une lecture humaine qu'on oublie de refaire (voir RGPD.md §8.1).
- **Ce que ces fonctions ont le DROIT de faire chez AWS, c'est un autre test qui le dit.**
  `edgeFunctionsIam.test.ts` balaie toutes les Edge Functions et rend la liste des actions IAM que
  leur code appelle — service lu sur l'import, jamais deviné du nom de la commande. Il ne lit pas la
  policy (elle vit chez AWS), il rend impossible de CHANGER la surface d'autorisation sans s'en
  apercevoir : c'est cette bascule silencieuse qui a mis l'extraction à terre le 21/09/2026. Même
  couple que ci-dessus : une moitié gardée par le code, l'autre par une vérification humaine.

- **Qui voit quoi, c'est un essai rejouable qui le dit** — `supabase/essais/rls.sql`, par
  impersonation réelle des trois profils sur les 40 tables du schéma **et sur les trois seaux de
  stockage**, qui sont le vrai enjeu : les données de patients sont dans les FICHIERS, pas dans les
  tables (RGPD.md §4). Il a trouvé, à sa première exécution, ce qu'aucune relecture n'avait vu : un
  visiteur anonyme lisait les catégories et les natures d'immobilisation du cabinet (voir
  « Décisions techniques »). Ce qu'il ne couvre PAS : les Edge Functions en HTTP, et la suppression
  d'un fichier (RGPD.md §8.6).
- Toutes les tables métier ont RLS activé (`rls_enabled: true` sur
  l'intégralité du schéma `public`) — aucune table de données cabinet/dossier
  ne doit être créée sans policy correspondante.
- Les accès clients sont volontairement restreints (dépôt de pièces, pas de
  visibilité sur montants/catégories/packs/autres onglets) — ne jamais
  élargir cet accès sans décision explicite.
- Secrets (clés API Resend, identifiants Super PDP, credentials Bedrock)
  stockés côté Supabase (secrets de fonctions / table dédiée chiffrée côté
  usage), jamais exposés au bundle client. `superpdp_credentials` contient un
  `client_secret` par dossier — à traiter comme une donnée sensible standard,
  jamais loguée en clair.
- Les données de dossiers **seront** des données comptables de clients réels (professions de santé
  notamment) ; elles sont fictives aujourd'hui (voir « État des données »). La règle ne change pas
  pour autant, et c'est délibéré : traiter dès maintenant toute pièce, e-mail ou export comme
  potentiellement identifiant, et ne jamais les faire transiter par un service tiers absent de cette
  liste. Une habitude prise sur des données fictives est la seule qui tiendra le jour où elles ne le
  seront plus.

## Fonctionnalités déjà implémentées

- Gestion multi-cabinets avec super-admin (`SuperAdminPage`), création/
  suppression de cabinet, charte graphique par cabinet (couleur, police,
  logo).
- Dossiers clients : création, checklist, informations (SIRET/adresse
  modifiables après création), détection auto du code NAF.
- Pièces & Documents : dépôt manuel ou import en masse, extraction OCR/IA
  (Textract), classification automatique, détection de doublons, validation.
- Banque : import de relevés, rapprochement, règles ignorées, écritures
  brouillon.
- Facturation client : émission de factures (numérotation légale
  séquentielle), factures d'avoir (jamais de modification en place d'une
  facture validée), envoi par e-mail (facture ou relance de pièces via
  `send-email`).
- Facturation électronique Super PDP : réception des factures fournisseurs
  (`superpdp-sync`) et émission de factures de vente conformes EN16931/CII
  (`superpdp-emit`), configuration des identifiants OAuth par dossier.
- Financement : suivi d'emprunts avec échéancier d'amortissement
  (`FinancementTab`, `src/lib/emprunts.ts`), et les 4 briques du dossier
  bancaire automatisé — situation intermédiaire (recettes/charges/résultat
  par poste 2035, même logique que Clôture, sur une période libre du 1er
  janvier à une date choisie, plus la trésorerie à cette date :
  `src/lib/situationIntermediaire.ts`), plan de trésorerie (projection du
  solde bancaire par moyenne mensuelle réelle observée — emprunts et
  cotisations déjà compris puisqu'ils transitent par le même compte, liste
  séparée des échéances connues à titre indicatif : `src/lib/planTresorerie.ts`),
  échéancier des dettes consolidé + ratios bancaires (capacité de
  remboursement = dettes financières / CAF annuelle estimée, taux
  d'endettement mensuel = mensualités / moyenne des encaissements —
  `src/lib/ratiosBancaires.ts`), et prévisionnel à 3 ans (taux de croissance
  annuel uniforme sur CA/charges de référence, préchargeables depuis une
  année passée, plus une note d'hypothèses en texte libre — jamais devinée
  par l'app, une ligne par dossier dans `previsionnels_bancaires` :
  `src/lib/previsionnel.ts`).
- Suppléments : prestations ponctuelles hors mission courante (création/
  fermeture de société, situation intermédiaire, autre), à facturer ou
  facturée avec lien facultatif vers la facture réelle ; et comptes courants
  d'associés (un par associé, mouvements apports/retraits/intérêts, solde
  toujours recalculé depuis l'historique) — voir `SupplementsTab`,
  `src/lib/supplements.ts`, `src/lib/cca.ts`.
- Immobilisations, Cotisations sociales (avec lecture best-effort d'avis
  d'appel URSSAF/CARPIMKO), Clôture, Estimation (aide à la déclaration 2035),
  Statistiques (balance tous comptes), Virements, Accès client, Équipe.
- Piste d'audit fiable : contrôle des ruptures (écriture sans justificatif,
  contrepartie sans mouvement) dans Écritures et en tête de Checklist, chiffrage
  de ce que le FEC ne contiendra pas, et **export CSV de la piste elle-même** par
  exercice — voir `src/lib/pisteAudit.ts` et la règle détaillée plus bas.
- Un client avec plusieurs sociétés (plusieurs dossiers rattachés au même
  compte, une ligne `memberships` par dossier) peut basculer entre elles via
  un sélecteur dans son espace (`AuthContext.mesSocietes`/`dossierActifId`,
  voir `Layout.tsx`) — les 4 écrans client (accueil, pièces, informations,
  simulation) suivent la société sélectionnée plutôt que la première par
  défaut.
- L'accueil client (`ClientHome`) est aussi un petit tableau de bord : tuiles
  d'action d'abord (la photo en tête), puis quatre tuiles chiffrées (envois de
  l'année avec tendance sur 12 mois, pièces en cours de vérification, relevés
  reçus, cotisations), "Ce qu'il reste à envoyer" (anneau d'avancement) et
  "Mes derniers envois". Chiffres volontairement limités à ce qu'un
  non-comptable comprend et formulés de son point de vue ("en cours de
  vérification", pas "à valider") — jamais de solde, de TVA ni de résultat
  côté client. Les trois points de "Ce qu'il reste à envoyer" sont les mêmes
  que ceux de `ClientUpload` et de la Checklist du cabinet, avec le même
  `moisEcoulesCetteAnnee()` : les trois écrans doivent toujours dire la même
  chose au même moment.
- Assistant comptable IA par dossier, avec plafond de coût mensuel
  configurable par cabinet (alerte non bloquante + blocage réel côté
  `agent-comptable`).
- Export de pack (ZIP + Excel récapitulatif) à la demande, export global
  d'un cabinet, export de sauvegarde avant suppression d'un dossier/cabinet.
- Reprise d'un dossier venu d'un autre logiciel, première brique : lecture et
  CONTRÔLE d'une balance générale (`BalanceCard`, onglet Informations) — colonnes
  reconnues à leur contenu, contrôle débit = crédit, lignes écartées avec leur
  motif. Rien n'est enregistré, et l'écran le dit : aucune table ne porte encore
  de balance reprise.
- Sauvegarde et restauration d'un dossier (`lib/sauvegarde.ts` pour le socle pur,
  `lib/sauvegardeDonnees.ts` pour les lectures/écritures, `lib/sauvegardeFichier.ts`
  pour le fichier). Téléchargement depuis l'onglet Informations d'un dossier,
  restauration depuis l'écran super-admin. **À ne pas confondre avec un pack** : un
  pack contient les FICHIERS, une sauvegarde contient les LIGNES qui les relient ; il
  faut les deux pour repartir de zéro, et c'est la confusion la plus coûteuse à laisser
  s'installer. Voir PLAN_DE_REPRISE.md.
- **Marche 1 de la réduction du coût d'extraction — TERMINÉE ET ÉPROUVÉE le 21/09/2026.**
  `extract-piece` lit par `DetectDocumentText` (OCR seul) puis fait CITER les champs par un modèle.
  Socle, mesure, branchement, déploiement et vérification en production, tous livrés le même jour
  (le contrat de citation lui-même vit dans « Décisions techniques »). **La marche 2 qui devait la
  suivre est écartée** — voir la décision du 21/09/2026, prise sur les chiffres ci-dessous.
  **ÉPROUVÉE EN PRODUCTION le 21/09/2026** (version 43), après un premier dépôt à 500 : la policy
  IAM n'autorisait pas les trois nouvelles actions Textract — voir « un déploiement n'est pas une
  autorisation » dans « Problèmes connus », c'est là que vivent la leçon et son garde-fou. Policy
  corrigée (`DetectDocumentText`, `StartDocumentTextDetection`, `GetDocumentTextDetection` ajoutées
  à `jd-precompta-textract`), relecture relancée, chaîne complète passée : OCR asynchrone,
  3 266 caractères archivés, citation rendue, date écrite. **Bedrock répond bien depuis la région
  de Textract** — c'était le seul point que cet environnement ne pouvait pas vérifier.
  **ET LA MESURE CORRIGE L'ÉCONOMIE ANNONCÉE, DANS LE MAUVAIS SENS.** Relevé sur ce document de
  2 pages : `2 214 tokens entrée, 86 tokens sortie`. Aux tarifs Sonnet habituels (3 $/M en entrée,
  15 $/M en sortie — à confronter à la facture AWS réelle, Bedrock ayant sa propre grille) :

  | | OCR | Citation | Total |
  |---|---|---|---|
  | Avant (`AnalyzeExpense`) | 0,0200 $ | — | **0,0200 $** |
  | Après (`DetectDocumentText` + citation) | 0,0030 $ | 0,0079 $ | **0,0109 $** |

  Soit **≈ 1,8×**, pas les « ~7× » que le tarif OCR seul laissait croire ni les ~3× estimés au
  branchement. **L'étage 2 est devenu 73 % du coût** : l'économie de l'étage 1 est réelle mais
  l'étage 2 en reprend les deux tiers.
  **SECONDE MESURE, SUR UN DOCUMENT DENSE, ET LE RAPPORT N'EST PAS LE MÊME** : 80 042 caractères,
  `25 983 tokens entrée, 69 tokens sortie`, de l'ordre de 30 pages. Citation 0,079 $, OCR 0,045 $,
  total **0,124 $** contre **0,30 $** par l'ancien chemin — soit **≈ 2,4×**, et l'étage 1 y pèse 36 %
  au lieu de 27 %.
  **Ce qui fait varier le rapport n'est PAS la taille mais le DÉCOUPAGE EN TOKENS** : 3,1 caractères
  par token ici contre 2,0 sur la facture courte. Un document administratif en phrases se découpe
  bien ; une facture pleine de références, de montants et de capitales se découpe mal, et coûte donc
  proportionnellement plus cher à faire citer. **Le coût de l'étage 2 suit le texte, celui de
  l'étage 1 suit les pages** — deux grandeurs différentes, et c'est pourquoi un rapport unique
  n'existe pas. Retenir la fourchette, pas un chiffre : **entre 1,8× et 2,4×** sur les deux documents
  réels mesurés.
  **Le texte OCR domine l'entrée, pas le prompt** : 1 177 caractères de prompt contre 3 266 de
  texte, soit 26 % — donc la mise en cache du prompt rapporterait peu, contrairement à ce qu'on
  suppose d'habitude. Ce qui surprend davantage : **2,0 caractères par token**, moitié moins que
  l'ordinaire. Un texte OCR français plein de références, de montants et de capitales se découpe
  mal, et c'est lui qui décide de la facture.
  **Conséquence directe pour la marche 2, à ne pas se raconter autrement** : sortir l'OCR d'AWS
  retire 0,0030 $ sur 0,0109 $, soit 27 %. Le gain de la marche 2 est donc surtout **RGPD** (un
  sous-traitant de moins sur des documents qui portent des noms de patients), pas budgétaire. La
  vraie prochaine économie, si on en cherche une, est du côté du modèle de citation — un modèle plus
  petit, mesuré sur les 41 textes comme l'a été celui-ci, jamais changé en passant.
  **LA PAGINATION `NextToken` EST CONFIRMÉE EN PRODUCTION** (21/09/2026, second dépôt réel). Le
  premier document, 2 pages et 3 266 caractères, faisait de l'ordre de 600 blocs — sous le seuil de
  1 000, donc la boucle n'avait pas tourné. Le second l'a exercée sans ambiguïté : **80 042
  caractères, 1 325 lignes OCR, ~10 925 mots**, soit de l'ordre de **12 250 blocs** (Textract émet un
  bloc par MOT en plus d'un par ligne). À 1 000 blocs par réponse, cela fait **au moins treize pages
  de résultats, donc douze allers-retours `NextToken`**.
  **Sans la boucle, 92 % de ce document serait parti en silence** : la première réponse porte ~1 000
  blocs, soit environ 8 % du texte, et rien — ni erreur, ni avertissement — ne l'aurait dit. Le texte
  archivé aurait été tronqué, la classification faite sur un fragment, et le modèle aurait cité des
  champs dans un texte qu'on lui avait coupé. C'est exactement le dégât annoncé, mesuré.
  **Le COMPTE des rejets de citation est journalisé depuis la version 44** — jamais les valeurs, une
  citation rejetée étant une chaîne tirée du document, donc possiblement un nom de patient. Sans lui
  il n'en restait rien : `_citations_rejetees` repart vers le navigateur, et une relecture en masse
  le jette (elle n'écrit que la date et le texte, par conception).
  **VERSION 44 DÉPLOYÉE le 21/09/2026**, vérifiée par aller-retour — zéro différence résiduelle sur
  1 221 lignes. Elle porte ce journal et la correction du budget mural (voir « un budget fixe est
  juste tant que personne ne le dépasse »).
  **Et le journal a rendu son premier chiffre utile dès le dépôt suivant** : `3 champ(s) cité(s),
  0 rejeté(s)` sur un document de 80 000 caractères. Le contrat de citation, mesuré hors ligne sur
  les 41 textes (209 citations, zéro invention), se comporte de même en production sur un document
  vingt fois plus long que ceux du corpus. Les trois champs non cités sont rendus `null` par le
  modèle, ce qui est la bonne réponse quand ils ne figurent pas sur le document — un `null` se
  saisit à la main, une valeur inventée passe inaperçue.
- Ergonomie issue d'un audit comparatif avec un logiciel concurrent (MEG,
  utilisé par l'expert-comptable de l'utilisateur) : fiche pièce en deux
  colonnes avec pied de formulaire fixe ; exercice unifié en en-tête du
  dossier (voir AnneeContext) ; aperçu du justificatif et message explicite
  sur l'absence de candidat directement dans le panneau de rapprochement
  bancaire (`lib/depot.ts::ouvrirJustificatif`) ; badge de rapprochement
  distinct du statut de validation dans la liste des pièces ; "Statistiques"
  renommé "Balance des comptes" avec un tableau de pilotage (évolution
  mensuelle des encaissements/décaissements, avancement du dossier — voir
  `lib/tableauPilotage.ts`) ; navigation clarifiée (Justificatifs/Documents
  administratifs/Factures émises) et paragraphes d'intro longs raccourcis
  avec le détail replié en `<details>`.
- **Purge du texte OCR des pièces sensibles après clôture d'exercice (22/09/2026)**, décision du
  cabinet tranchée dans « Décisions en attente » : option B (purger après clôture), restreinte aux
  pièces sensibles — les justificatifs de recette (bordereaux de télétransmission), seule famille à
  porter des données de patients. `ClotureTab` porte un bouton « Clôturer l'exercice » par exercice
  affiché : il pose une ligne dans la nouvelle table `exercices_clotures` (RLS vérifiée par
  impersonation réelle, convention `admin_du_dossier` habituelle) puis supprime `piece_textes_ocr`
  des pièces validées de cet exercice dont `type_piece = 'vente'` — jamais les fichiers déposés, et
  jamais une facture ordinaire. Rejouer le bouton sur un exercice déjà clôturé rattrape les pièces
  sensibles validées depuis, sans reposer une seconde ligne de clôture. Ce geste n'est PAS une
  clôture comptable réelle (voir le bandeau brouillon de l'écran) : `exercices_clotures` ne porte
  qu'une date, celle de la demande de purge. Détail dans `src/lib/clotureExercice.ts` et RGPD.md
  §8.3. La lecture des pièces sensibles à purger passe par `lireTout`, jamais un `select` nu : une
  purge qui croirait avoir tout supprimé sur une lecture tronquée serait pire que pas de purge, et
  se refuse donc plutôt que de n'en faire qu'une partie. Deux mutations délibérées confirment que la
  fonction mord (le second appel n'insère pas de doublon, une lecture incomplète bloque la purge).

## Fonctionnalités actuellement en cours

- Test en conditions réelles du bac à sable Super PDP (émission de facture)
  avec l'utilisateur — plusieurs règles EN16931 déjà corrigées suite à des
  rejets réels du validateur (voir "Problèmes connus" ci-dessous pour les
  pièges déjà traités).

## Feuille de route — page Notion à tenir à jour

La feuille de route du projet vit dans une page Notion, et non dans ce
fichier : elle couvre le chemin complet du premier commit jusqu'à une
application qui tiendrait seule la production d'un cabinet, y compris ce qui
est difficile et ce qui est hors d'atteinte pour des raisons légales.

**Page** : « jd-precompta — état des lieux et route vers le cabinet autonome »
(https://app.notion.com/p/3df6a715e8ad81148546d58c449c593a). Elle contient une
base inline « Feuille de route — du premier commit au cabinet autonome », triée
par la colonne `Ordre` : le livré d'abord (phase 0), puis le restant dans
l'ordre de ses dépendances (phases 1 à 7).

**Règle** : à chaque chantier terminé, mettre la ligne correspondante à
`État = Fait`, `Effort = Fait`, `Phase = 0 — Livré`, et compléter
`Quand / ce qui bloque` avec la date et ce que le travail a réellement changé —
y compris ce qu'il a coûté ou révélé, pas seulement ce qu'il a ajouté. Les
autres lignes gardent leur `Ordre` : seule la phase change, pour que la
frontière entre le fait et le restant se lise d'un coup d'œil.

Ajouter une ligne quand un chantier apparaît en cours de route. Le cas le plus
fréquent est celui d'un défaut trouvé en travaillant sur autre chose — c'est
ainsi que les 56 paiements par carte incapables de confirmer leur fournisseur
ont été découverts, en cherchant à apparier une facture en dollars.

## Problèmes connus importants

- **Les advisors de sécurité Supabase ne seront jamais tous au vert, et deux
  familles sont à laisser telles quelles :**
  - `auth_leaked_password_protection` (WARN) — **non corrigeable sur ce
    projet.** Le contrôle des mots de passe contre HaveIBeenPwned est réservé
    au plan **Pro**, et l'organisation (`dloewvpmposfbvdwtqfz`) est sur le plan
    **free** : la case est absente du dashboard, pas seulement décochée. Ce
    n'est donc pas une négligence à corriger mais une fonctionnalité payante,
    et le risque est faible ici (2 comptes, ceux du cabinet — pas une base
    d'utilisateurs exposée au credential stuffing). Ne pas repartir en chasse
    à chaque audit. Ce qui **est** réglable gratuitement, et vaut le détour :
    la longueur minimale et les classes de caractères obligatoires, dans
    Authentication → Providers → Email (8 caractères minimum, chiffres +
    minuscules + majuscules + symboles).
  - `anon_security_definer_function_executable` et
    `authenticated_security_definer_function_executable` (WARN, 6 et 8 fonctions) — **vérifiés
    bénins, par impersonation réelle et non par relecture.** Toutes les fonctions `SECURITY DEFINER`
    du schéma sont exposées en RPC, ce que l'advisor signale à juste titre ; encore faut-il savoir ce
    qu'elles font sans session. Deux seulement ÉCRIVENT (`enregistrer_facture`,
    `prochain_numero_facture`) et toutes deux portent leur propre contrôle d'accès — c'est la
    convention du projet sur les fonctions `SECURITY DEFINER`, et elle tient. Les autres sont des
    lectures qui dépendent de `auth.uid()` : sans session elles rendent `false` ou `null`.
    `set_cabinet_id_dossier` n'est pas exposée du tout (fonction de trigger, `EXECUTE` refusé à
    `anon` comme à `authenticated`).
    Le cas qui méritait la vérification est `prochain_numero_facture` : malgré son nom elle
    **consomme** un numéro (upsert +1), et un appel anonyme réussi aurait creusé un trou dans une
    suite annuelle qui n'en admet pas. Éprouvé sur le dossier réel — `anon` et un client authentifié
    non-admin se font tous deux refuser, et `facture_numerotation` reste à 6. Ne pas repartir en
    chasse à chaque audit : ce qui rendrait ces avertissements dangereux, c'est qu'une NOUVELLE
    fonction `SECURITY DEFINER` écrive sans contrôle d'accès interne. C'est cela qu'il faut
    revérifier, pas l'advisor lui-même.
  - `rls_enabled_no_policy` (INFO) sur `super_admins`, `superpdp_credentials`
    et `facture_numerotation` — **volontaire.** RLS activée sans aucune policy
    vaut refus total côté client : ces tables ne sont atteintes que par les
    fonctions `SECURITY DEFINER` et le service role. Y ajouter une policy pour
    faire taire l'advisor ouvrirait précisément ce que ce réglage ferme.
- **`pack_pieces` a été supprimée** (migration `drop_table_morte_pack_pieces`).
  Elle devait tracer la composition de chaque pack livré au comptable ; le
  générateur ne l'a jamais écrite. La preuve n'était pas qu'elle soit vide mais
  qu'elle le soit **restée après qu'un pack a réellement été généré** — donc
  contournée, pas « pas encore utilisée ». `packs` porte `nb_pieces` (un
  compteur) et les chemins ZIP/Excel, la composition réelle vivant dans les
  fichiers livrés. Conséquence à connaître : savoir « quelles pièces dans le
  pack X » n'est pas modélisé en base, et ne l'a jamais été. Si le besoin
  apparaît, le reconstruire depuis la période du pack et le statut des pièces,
  ou créer une table réellement alimentée — ne pas recréer celle-ci à
  l'identique en espérant qu'elle se remplisse.
- **`supabase.functions.invoke()` ne peuple jamais `data` en cas d'erreur** —
  toujours utiliser `extraireErreurFonction()` (voir "Décisions
  techniques"), jamais lire `data?.error` directement sur un appel qui peut
  échouer.
- **Pièges EN16931/Super PDP déjà rencontrés et corrigés dans
  `superpdp-emit`**, à garder en tête pour toute évolution de cette
  fonction :
  - Chaque ligne de facture doit porter son propre `vat_information`
    (catégorie + taux de TVA) en plus de la ventilation au niveau document
    (règle BR-S-08).
  - Chaque ligne doit avoir un `invoiced_quantity_code` (unité de mesure
    UN/ECE Rec. 20) — l'appli utilise un code générique `"C62"` par défaut
    (règle BR-23).
  - Une facture avec au moins une ligne au taux normal doit porter le n° de
    TVA intracommunautaire du vendeur (règle BR-S-02), calculé depuis le
    SIREN, omis si toutes les lignes sont exonérées.
  - `is_valid=false` dans un rapport de validation Super PDP **ne signifie
    pas forcément un rejet bloquant** — un rapport composé uniquement
    d'avertissements (`flag="warning"`) porte aussi ce statut. Le blocage ne
    doit se faire que sur un message non-avertissement effectivement présent.
  - L'entreprise authentifiée côté Super PDP (liée aux identifiants OAuth du
    dossier) doit correspondre exactement au SIRET déclaré comme vendeur
    dans la facture, sinon `POST /invoices` rejette avec un message explicite
    — comportement normal de Super PDP, pas un bug applicatif : pour tester
    en bac à sable, le SIRET du dossier de test doit être aligné sur le
    SIREN de l'entreprise sandbox utilisée.
- **Un module de calcul n'importe jamais le client Supabase** : `supabase.ts` lève au
  chargement quand les variables d'environnement manquent, ce qui rend intestable tout
  module qui le tire, fût-ce pour une constante. Les opérations qui parlent à la base
  vivent à part (`comptes.ts` pour les numéros de comptes PCG, `contrepartieBanque.ts`
  pour les deux écritures bancaires) — c'est ce découplage qui rend `ecritures.ts`,
  `fec.ts` et les autres couvrables. Même règle pour les dépendances navigateur :
  `pdfText.ts` charge pdf.js, qui touche au DOM dès l'import, donc la lecture des
  opérations d'un relevé PDF vit dans `relevePdf.ts`.
- **Un montant ou une date bancaire n'est jamais analysé deux fois** : `csv.ts` porte
  les deux seuls analyseurs (`parseMontantBancaire`, `parseDateBancaire`). Toute
  expression régulière parallèle finit par diverger d'eux, et en silence — c'est le
  défaut qui rendait 1,23 € pour « 1.234,56 » à l'import CSV, puis 846,47 € pour
  « 20846,47 » à l'import PDF. Une expression régulière peut *repérer* un montant dans
  une ligne ; elle ne l'interprète pas.
- **Sur un relevé à deux colonnes Débit / Crédit, le sens est une information de mise en
  page, pas de texte.** Une fois les fragments recollés, les deux colonnes donnent la
  même chaîne : c'est l'abscisse du montant (`LignePdf.xFin`, gardée par
  `extractPdfLignes`) qui les sépare. D'où le sélecteur « Format du montant » côté PDF
  comme côté CSV — sans lui, tout un relevé ressortait en positif.
- **Une écriture en base est vérifiée, jamais supposée réussie.** `supabase.from(...)` ne lève
  pas : l'erreur se lit dans `{ error }`. Un `await` sans destructuration est un échec
  silencieux — c'est ainsi que la règle tiers → catégorie du cabinet a échoué à chaque
  tentative pendant des mois (`cabinet_id` absent du payload *et* `onConflict` ne
  correspondant à aucun index unique), table vide, sans un seul signal. Une écriture
  best-effort reste non bloquante, mais elle est journalisée.
  Le danger se mesure à ce que l'écran fait ensuite : le plus souvent un `load()` suit, donc
  l'échec se voit (l'ancien état réapparaît). Les cas à traiter en priorité sont ceux que
  **rien ne recharge** — une écriture d'effet de bord, une suppression suivie d'un retrait
  optimiste de l'état local, ou un `delete` dont dépend l'`insert` suivant (c'est ce dernier
  motif qui dupliquait les lignes d'une facture modifiée).
- **Ce motif aussi se balaie, et il s'est avéré en bien meilleur état que celui du verrou.** Balayage
  du 20/09/2026 : les `await supabase…` dont le résultat n'est pas destructuré, croisés avec la
  question qui décide — *quelque chose recharge-t-il derrière ?* Trente sites, et **deux seulement**
  étaient de vrais défauts, tous deux dans `SuperPdpModal` : `retirer()` ignorait entièrement le
  résultat d'une action DESTRUCTRICE que l'utilisateur venait de confirmer (l'échec rafraîchissait un
  statut inchangé, sans un mot — et le réflexe, recliquer, rendait le même silence), et
  `chargerStatut()` affichait un message générique là où `extraireErreurFonction` en avait un vrai.
  Tout le reste est suivi d'un `load()`, donc l'échec se voit : la ligne supprimée réapparaît.
  **Deux résultats négatifs à garder, pour ne pas les rechercher à chaque audit :**
  - Le cas que ce fichier désignait comme prioritaire — une suppression suivie d'un **retrait
    optimiste de l'état local** — n'existe nulle part dans le code. Aucun `delete()` n'est suivi d'un
    `filter()` sur l'état ; tous rechargent.
  - `tauxChange.tauxBce` lit bien `{ data, error }` sans passer par `extraireErreurFonction`, et
    c'est **légitime** : il ne montre aucun message, il journalise (`console.error` avec la devise,
    la date et la réponse) puis rend `null`, l'appelant décidant de la suite. La règle « tout
    `invoke()` passe par `extraireErreurFonction` » vise l'affichage d'un message à l'utilisateur —
    un best-effort journalisé la satisfait autrement. Sur treize appels, c'est la seule exception.
- **Ce qui doit être tout ou rien vit dans une fonction SQL.** Une facture s'enregistre en un
  seul appel (`enregistrer_facture`) : en-tête, remplacement des lignes, numéro et validation
  dans la même transaction. En trois à cinq allers-retours, un échec au milieu laissait la
  facture à mi-chemin — lignes doublées, ou numéro consommé sans être posé, c'est-à-dire un
  trou dans une suite annuelle qui n'en admet pas. Ces fonctions sont `SECURITY DEFINER`,
  contournent donc la RLS et **vérifient l'accès elles-mêmes** (`admin_du_dossier`) ; elles
  énumèrent les colonnes qu'elles écrivent au lieu d'un `jsonb_populate_record`, sans quoi
  l'appelant pourrait forger `numero` ou `statut`.
- **Ce qui est déjà testé en TypeScript n'est pas réécrit en SQL.** `enregistrer_facture` stocke
  les montants tels que `calculerLigne` les a calculés plutôt que de refaire l'arrondi côté base :
  l'atomicité suffit à garantir que l'en-tête décrit le jeu de lignes dont il vient. À l'inverse,
  le *format* du numéro est passé du TypeScript au SQL (`numero_facture_formate`), la base devant
  de toute façon l'écrire elle-même.
- **Une Edge Function auto-portée duplique du code, donc elle est gardée par un test.**
  `extract-piece` ne peut rien importer de `src/lib` et redéclare sa lecture de montant.
  `extractPieceMontants.test.ts` lit la vraie source déployée, en extrait `parseAmount` et
  l'exécute — volontairement fragile : renommer la fonction casse le test bruyamment, ce qui
  vaut mieux qu'une copie qui dérive en silence. Même harnais pour `dateDepuisTexteBrut`
  (`extractPieceDate.test.ts`) et pour `classifieDocument`
  (`extractPieceClassification.test.ts`).
  **La duplication la plus coûteuse n'était gardée par AUCUN d'eux** (corrigé le 20/09/2026).
  `superpdp-emit` redéclare le calcul des montants d'une ligne de facture — cette section le nommait
  depuis le début (« ex. calcul de montants de ligne de facture ») — et les huit tests-garde du
  dépôt couvraient `extract-piece` et `receive-email`, pas celui-là. Ce qu'une dérive coûterait :
  la copie de `src/lib` décide de ce qui est ENREGISTRÉ, celle de l'Edge Function de ce qui est
  TRANSMIS à une plateforme agréée DGFiP — deux arrondis différents, et la facture que le cabinet a
  sous les yeux n'est plus celle que l'administration reçoit, sur un document légal, sans qu'aucun
  écran ne puisse le voir. `superpdpMontants.test.ts` compare les deux sur une batterie de bornes
  d'arrondi, quantités négatives (les avoirs) comprises.
  **La paire ne se trouve pas par son nom** : `calculerLigne` d'un côté, `calculerLigneMontants` de
  l'autre, formes de retour différentes. C'est « chercher la VALEUR, pas le nom de la fonction »
  appliqué à la lettre — un grep sur le nom les aurait ratées.
  **Et le premier jeu de cas NE PROUVAIT PAS ce qu'il annonçait.** Le test disait figer « la TVA
  s'arrondit sur le HT DÉJÀ arrondi » ; la mutation correspondante a SURVÉCU, parce que l'arrondi du
  HT ne déplace la TVA que de 0,001 au plus — invisible au centime, sauf quand il fait franchir un
  demi-centime. Les cas distinctifs (`1 × 0,175 € à 20 %` rend 0,04 contre 0,03) ont été trouvés par
  recherche exhaustive sur les quatre taux français et les prix au millième, pas devinés. Le test
  vérifie d'ailleurs que chacun **distingue** bien les deux formules, sinon il ne prouverait rien.
  **Les textes de ces tests sont reconstruits, jamais copiés d'un document réel** : les bordereaux
  et feuilles de soins portent des noms de patients, des dates de naissance et des numéros de
  sécurité sociale, qui n'ont rien à faire dans un dépôt Git. Seules la structure et les mentions
  qui servent de marqueur sont reproduites — c'est tout ce que la fonction regarde. Pour vérifier
  un changement de classification sur le corpus réel, faire tourner les marqueurs **en base**
  (`piece_textes_ocr`, regex extraites de la source) plutôt que rapatrier les textes.
- **Une déduction se dit, elle ne se déguise pas en lecture.** Faute de libellé reconnu, la date
  d'une pièce est prise comme la première en ordre de lecture — une facture imprime sa date en
  en-tête, avant ses conditions de règlement et ses mentions légales. Cette règle avait d'abord été
  écartée (mieux valait null qu'une date fausse) ; un cas réel l'a tranchée, huit factures d'un même
  fournisseur donnant toujours, dans cet ordre, la date de facture, trois mentions légales
  constantes, puis l'échéance — et le recoupement avec les numéros de facture donne une série
  strictement croissante. Le résultat est marqué `_date_deduite` et remonté à part (« à vérifier »),
  jamais confondu avec une date lue sur un libellé. Le diagnostic porte la ligne d'origine de chaque
  date : sans elle, un échec ne dit que « voici des dates ».
- **Une reprise en masse ne réécrit que le champ qu'elle vient chercher.** « Retrouver les dates
  manquantes » (onglet Pièces, `lib/reextractionDates.ts`) rejoue l'extraction sur les pièces sans
  date et n'écrit que `date_piece`. Jamais le tiers, les montants ni le statut : ces pièces sont
  pour la plupart déjà validées, donc relues et corrigées à la main — les réécrire avec ce que l'OCR
  croit lire détruirait ce travail sans que rien ne le signale. Séquentiel et non parallèle (chaque
  PDF repasse par le chemin asynchrone de Textract), un échec n'interrompt pas le lot, et les pièces
  restées sans date remontent les dates vues plutôt qu'un simple échec.
- **Un champ que l'OCR a lu mais que Textract n'a pas étiqueté n'est pas un champ perdu.**
  `AnalyzeExpense` rend deux choses : du texte brut ligne à ligne, et des champs qu'il *tente*
  d'étiqueter. L'étiquetage est irrégulier — `INVOICE_RECEIPT_DATE` n'est sorti que sur 4 factures
  sur 22 d'un même fournisseur, alors que la date était lue dans tous les cas. Chaque champ qui
  compte a donc un repli sur le texte brut, comme la TVA en avait déjà un. Le repli reste prudent :
  il écarte les lignes d'échéance ou de règlement, refuse de trancher entre plusieurs dates sans
  libellé, et rend un diagnostic plutôt qu'une valeur plausible — une pièce datée à tort part dans
  le mauvais mois, parfois dans le mauvais exercice, sans que rien ne le signale.
- **Un contrôle qui ne peut se déclencher que sur une correction humaine est un contrôle à
  l'envers — celui-là ne sera donc pas construit.** « Le montant stocké n'apparaît pas dans le texte
  OCR » semble être le contrôle de cohérence qui manque ; il est en réalité tautologique, puisqu'un
  montant extrait VIENT du texte et s'y trouve par construction. **Mesuré le 19/09/2026 sur le
  dossier `test`** : 39 pièces sur 39 portant un montant l'ont écrit mot pour mot dans leur propre
  texte, zéro absent. Le seul cas où il se déclencherait est celui d'un montant corrigé à la main par
  le cabinet — précisément celui où l'humain a raison et l'OCR avait tort. Il ne signalerait donc que
  le travail bien fait, et un avertissement qui se trompe toujours finit par emporter dans son
  discrédit les avertissements voisins qui, eux, disent vrai.
  **Le piège était dans la requête, pas dans les données** : comparer `montant_ttc` (en euros) au
  texte des factures en dollars faisait apparaître quatre manquants — c'est `montant_devise` qu'une
  pièce en devise écrit sur son document. Un premier comptage rendait donc 35 sur 39, et la
  conclusion aurait été juste pour une raison fausse.
  Ce qui reste la bonne piste est inchangé : une source EXTÉRIEURE au document (le relevé bancaire,
  `piecesMontantIntrouvableEnBanque`), pas une cohérence interne de plus.
- **Une liste plafonnée dit qu'elle l'est.** Les outils de l'agent comptable rendaient leur
  tableau tronqué tel quel, indiscernable d'une liste complète : le modèle en tirait un total
  qu'il annonçait au comptable, alors même que le prompt lui demande des montants exacts et de
  signaler des données insuffisantes — ce qu'il ne pouvait pas faire faute de le savoir. Un
  plafond s'accompagne donc du total réel (`count: "exact"`, qui ne rapatrie rien) et d'un
  drapeau `tronque`. C'est la version « données » de la règle ci-dessous sur les livrables.
- **Un livrable incomplet le dit, il ne se contente pas d'être incomplet.** Un pack est
  envoyé au comptable : quand une pièce ne peut pas être ajoutée au ZIP, elle est recensée,
  écrite dans une feuille « Pièces manquantes » du récapitulatif *et* remontée à l'écran.
  Auparavant l'Excel l'annonçait, le total la comptait, l'archive ne la contenait pas.
- **Un fichier envoyé au stockage sans ligne en base est un orphelin.** L'import retire le
  fichier quand l'insertion échoue, et ne retient son empreinte qu'une fois la ligne écrite —
  la retenir avant faisait passer pour « déjà présent » un fichier dont l'import venait
  d'échouer.
- **Les API paginées de Storage sont paginées explicitement.** `list()` plafonne à 100 entrées
  sans le signaler : la suppression d'un dossier laissait tout le reste orphelin au-delà.
- **ET TEXTRACT AUSSI, par une porte que le passage à la détection de texte vient d'ouvrir**
  (21/09/2026). `GetDocumentTextDetection` rend ses résultats par PAGES et ne le signale que par un
  `NextToken` — `AnalyzeExpense` rendait les siennes autrement, donc ce piège n'existait pas avant.
  Sans la boucle, un document de plusieurs pages perd tout au-delà des mille premiers blocs : texte
  OCR tronqué, donc classification faite sur un fragment, 2035 lue à moitié, échéancier de cotisation
  amputé, et un modèle à qui l'on demande de citer des champs dans un texte qu'on lui a coupé. Aucune
  erreur nulle part.
  **Une différence avec PostgREST, à vérifier avant d'appliquer le même raccourci ailleurs** : ici la
  fin est ANNONCÉE par l'API (absence de `NextToken`) et non déduite d'une tranche plus courte que
  demandée. C'est ce qui dispense d'un compte annoncé — et c'est exactement ce que `lireTout` ne peut
  PAS supposer de PostgREST.
  **La boucle est écrite sur un FOURNISSEUR DE PAGES et non en ligne dans l'appel AWS**, entre les
  bornes `── DÉBUT/FIN PAGINATION` : c'est ce qui permet à `extractPiecePagination.test.ts` de
  l'EXTRAIRE et de l'EXÉCUTER contre un faux pagineur. Les autres garde-fous de cette fonction
  vérifient un câblage par recherche de texte, faute de pouvoir lancer du Deno ici ; celui-là n'avait
  pas cette excuse. Le faux pagineur REFUSE un jeton déjà servi, pour qu'une boucle qui redemanderait
  la même page échoue au lieu de tourner indéfiniment. Cinq cas, dont « une page vide n'est pas la
  fin » — c'est le `NextToken` qui décide, et confondre les deux couperait le document à la première
  page blanche.
- **Et la TABLE se pagine aussi : PostgREST plafonne le nombre de lignes rendues.** C'est le
  réglage « Max rows » du projet (1 000 par défaut), et il ne se signale pas — la réponse est une
  liste valide, simplement plus courte que la réalité. Un `select('*').eq('dossier_id', …)` rend
  donc un sous-ensemble sans le dire, et ce qu'on en calcule (balance, FEC, piste d'audit) est faux
  sans qu'aucune alerte ne paraisse. **Mesuré le 20/09/2026** : `lignes_bancaires` porte 954 lignes
  pour le cabinet, 385 sur le dossier vivant — personne n'a encore franchi le plafond, et le
  prochain relevé importé peut le faire. Ce réglage n'est pas lisible depuis cette base
  (`pg_db_role_setting` ne porte aucun `pgrst.*` : il vit dans la configuration de la plateforme),
  donc le code ne doit dépendre d'AUCUNE valeur supposée.
  `lireTout` (lib/lectureComplete.ts) lit par tranches et rend `{ lignes, complete, motif }`. Trois
  décisions :
  - **On avance de ce qui a été RENDU, pas de la taille demandée.** Si le plafond du serveur est
    plus petit que la tranche, une tranche « courte » n'est pas la fin de la table — s'en servir
    comme condition d'arrêt perdrait tout le reste. C'est la limite de la pagination du socle de
    sauvegarde (`sauvegardeDonnees.ts`), qui s'arrête sur une tranche courte et se rattrape en
    REFUSANT — elle peut se le permettre, une sauvegarde incomplète ne vaut rien ; un écran, lui,
    doit continuer.
  - **Le compte annoncé fait foi** (`count: 'exact'`, qui ne rapatrie aucune ligne) : sans lui,
    « rien de plus à lire » et « le serveur ne rend plus rien » sont indiscernables. Une lecture
    sans compte annoncé se déclare donc INCOMPLÈTE, et l'arrêt sur tranche vide est ce qui empêche
    un compte trop grand de faire boucler indéfiniment.
  - **Le tri doit être TOTAL.** `date` n'est pas unique : sans clé de départage (`.order('id')`),
    deux tranches se recouvrent ou sautent des lignes, et rien ne le signale — c'est le même piège
    que `CLES_PRIMAIRES` côté sauvegarde.
  **Branchés d'abord : ce qui produit un fichier qu'on envoie ou qu'on signe.** `EcrituresTab` lit le
  brouillon ainsi et refuse d'exporter le FEC ou la piste d'audit sur une lecture incomplète (le
  format FEC est rigide : il ne peut pas porter l'avertissement). `packGenerator` refuse de produire
  le pack — et c'est le cas le plus net : un pack amputé serait cohérent avec lui-même, ZIP,
  récapitulatif et total d'accord et faux tous les trois, et on ne peut même pas recenser ce qui
  manque comme on le fait pour les pièces sans date, puisqu'on ignore ce qu'on n'a pas lu.
  `ClotureTab` grise le remplissage du formulaire : une 2035 calculée sur une partie des pièces est
  plausible, fausse, et **signée**.
  Dans les trois cas l'écran DIT que sa lecture est partielle, plutôt que de laisser un bouton grisé
  sans raison visible.
  **Puis les écrans dont un CHIFFRE dépend** : Banque (la plus grosse table du projet), la Balance
  des comptes, la Checklist — celle-ci est le cas le plus retors, puisqu'elle prétend dire ce qui
  MANQUE : un contrôle qui ne voit qu'une partie du dossier se tait sur le reste, et se taire est
  exactement ce qu'on attend de lui quand tout va bien. Et la **liste des dossiers**, seule lecture
  du projet à porter sur tout le cabinet, donc la première qui touchera le plafond : tronquée, elle
  ne vide pas un compteur, elle en fausse quelques-uns — ceux des dossiers qui tombent au-delà de la
  coupure, ce qui est bien plus difficile à voir.
  `BandeauLecturePartielle` (src/components) porte le message : un seul composant, parce que ce qui
  doit être dit partout finit par n'être dit nulle part quand chaque écran le réécrit. Seule varie
  la `consequence` — ce que le cabinet a sous les yeux et qui est devenu faux ; « lecture partielle »
  tout seul ne dit pas si c'est grave.
  **Le portage est terminé** (20/09/2026) : plus une seule lecture de collection entière n'est faite
  en `select('*')` nu sur `pieces`, `lignes_bancaires`, `ecritures_brouillon`, `documents_divers`,
  `piece_textes_ocr` ou `piece_commentaires`. Deux endroits méritaient mieux qu'un bandeau, et
  LÈVENT :
  - `chargerHashsExistants` (lib/importFichiers.ts) — les empreintes du dédoublonnage. Une liste
    tronquée n'est pas une liste plus courte : c'est un dédoublonnage qui laisse passer tout ce
    qu'elle ne contient pas, sur un import en masse, donc à l'échelle du dossier entier.
  - `chargerEmpreintesTexte` (lib/doublonsTexte.ts) — même raisonnement : un détecteur de doublons
    qui en manque sans le dire vaut moins que pas de détecteur.
  Et `PresenceTexteOcr` traite une lecture INCOMPLÈTE exactement comme un refus, pour la même raison
  qu'au-dessus : ne pas savoir interdit de relancer une lecture facturée.
  **CE GREP ÉTAIT FAUX, ET IL RENDAIT ZÉRO POUR UNE RAISON FAUSSE** (corrigé le 20/09/2026). Le
  portage s'était appuyé sur `from('<table>')` + `select(` sans `count: 'exact'`, annoncé ici même
  comme rendant zéro et « à rejouer avant de croire qu'une table est couverte ». Mais un grep
  travaille LIGNE À LIGNE, or le formatage normal du dépôt coupe la chaîne Supabase sur plusieurs
  lignes : `.from('pieces')` sur l'une, `.select(…)` sur la suivante. Rejoué en tenant compte des
  retours à la ligne, il rend **trois** lectures non paginées — l'aperçu d'un pack (`PacksTab`), la
  liste des pièces à rapprocher (`BanqueTab`) et une lecture bornée par le modèle.
  **Une vérification qu'il faut « penser à rejouer », et dont personne ne peut voir qu'elle est
  fausse, ne vaut rien.** Elle est donc devenue un TEST (`lecturesPaginees.test.ts`) : il parcourt
  les sources, refuse toute lecture de collection sans compte annoncé, et n'admet d'exception
  qu'inscrite avec **la raison qui borne sa taille** — une seule à ce jour, les écritures d'UNE
  pièce, que la partie double limite à deux ou trois.
  **ET CE TEST-LÀ ÉTAIT FAUX À SON TOUR, POUR LA TROISIÈME FOIS SUR CETTE MÊME VÉRIFICATION**
  (corrigé le 20/09/2026). Sa première version délimitait le corps d'une chaîne par `[^;]*?` suivi
  d'un lookahead. Or **ce dépôt n'écrit pas de point-virgule**, et presque toutes les lectures
  vivent dans un `Promise.all([...])` dont les entrées se terminent par une VIRGULE : le corps
  grossissait donc jusqu'au commentaire suivant, **en avalant les `.from(...)` voisins au passage**.
  Le moteur reprenait après eux, et ces lectures-là n'étaient jamais examinées.
  La borne qui répare est simple et vérifiable : **un corps s'arrête au `.from(` SUIVANT**, quelle
  que soit sa table — un `.from(` ne peut pas appartenir à la chaîne en cours, donc on ne peut plus
  en sauter un. Les autres bornes ne font que RACCOURCIR le corps, ce qui est le sens sûr : un corps
  trop court se signale, un corps trop long se tait. Le commentaire n'est PAS une borne, sinon une
  chaîne qui en porte un avant son `.select(` passerait pour une écriture.
  **Son contrôle de mutation est devenu un défaut PLANTÉ, et c'est ce qui change tout.** « Le
  scanner voit-il encore quelque chose ? » était vrai par accident, l'unique exception déclarée
  suffisant à le satisfaire. Il lui est maintenant donné une source SYNTHÉTIQUE portant une lecture
  nue coincée entre deux lectures paginées, dans la forme exacte qui l'aveuglait — plus deux cas
  symétriques (une lecture correcte dont un commentaire coupe la chaîne, une écriture) pour qu'il
  ne se mette pas à crier au loup.
  Cinq mutations mordent, dont celle qui avait SURVÉCU avant correction et celle qui retire la
  borne au `.from(` suivant. Cinq autres gardent le portage lui-même : une lecture repassée en
  `select` nu, une exception retirée, une exception INVENTÉE (qui ne correspond à aucune lecture
  réelle — sans quoi la liste se remplirait de raisons mortes), et les deux refus sur lecture
  partielle de l'export de cabinet et des contrôles de relevé.
  **Deux faux clients de tests existants ont dû être alignés** (`exportCabinet`, `controlesReleves`,
  plus `VehiculesCard` côté écrans) : un faux client qui ignore `range` casse la chaîne, et un qui
  n'annonce pas de `count` fait déclarer INCOMPLÈTE toute lecture — le test passerait alors pour une
  raison fausse. C'est le coût récurrent de `lireTout`, et il se paie une fois par faux client.
  **Les deux défauts trouvés valaient le détour**, et le second est le plus vicieux du portage :
  l'aperçu d'un pack annonçait un total tronqué sans le dire, alors que `packGenerator` REFUSE de
  produire un pack sur une lecture incomplète — l'écran était donc plus optimiste que le générateur
  qui allait refuser juste après. Et il ne comptait pas non plus les pièces validées SANS DATE, que
  `gte`/`lte` écarte de toute période : l'opérateur lisait « 4 pièces », générait, et apprenait
  seulement alors qu'il en existait dix-huit autres. Les deux se disent maintenant à l'aperçu.
  **IL N'Y A PLUS DE LISTE DE TABLES À SURVEILLER : LE TEST LES SURVEILLE TOUTES** (20/09/2026).
  Elle s'arrêtait aux six collections volumineuses ; cinq l'ont d'abord rejointe — `categories`,
  `cotisations_declarees`, `immobilisations`, `vehicules`, `natures_immobilisation` — toutes
  MINUSCULES (43, 10, 2, 1, 8 lignes), ce qui est exactement ce qui rendait leur absence
  confortable. **Le balayage suivant a montré qu'il restait VINGT-TROIS tables dehors**, dont
  `dossiers` — que ce fichier désignait NOMMÉMENT comme « la première qui touchera le plafond » et
  dont la lecture n'avait jamais été portée, alors que les trois lectures SATELLITES du même écran
  l'avaient été. Le portage s'était fait autour de la chose qu'il prétendait protéger.
  **Une liste d'INCLUSION tenue à la main reproduit toujours la même panne** : elle ne contient que
  ce à quoi quelqu'un a pensé, et son silence est indiscernable d'un dépôt sain. Le test part donc
  de TOUTE lecture de collection, comme `rls.sql` part de `pg_class` — une table ajoutée demain est
  attrapée sans que personne ait à y penser. Il n'admet que des EXCEPTIONS écrites, chacune portant
  **la raison qui borne sa taille** : huit à ce jour, et toutes tiennent devant la question « et si
  ce cabinet en avait mille ? » — les lignes d'UNE facture, les événements d'UNE transmission, les
  sociétés d'UN utilisateur, le cours d'UNE devise à UNE date.
  **Vingt-neuf lectures portées d'un coup**, dans seize fichiers. Les plus coûteuses si elles
  étaient tronquées : `agent_conversations` sur l'écran super-admin (elle grandit d'une ligne par
  message, donc plus vite que tout le reste — tronquée, elle ne vide pas le compteur de coût IA,
  elle le SOUS-ESTIME, ce qui est la façon exacte dont un plafond cesse de protéger) ;
  `tiers_categories` et `tiers_categories_cabinet` dans Pièces (les règles apprises cessent
  simplement de s'appliquer, sans un signal, et l'opérateur recatégorise à la main un fournisseur
  déjà arbitré dix fois) ; `mouvements_cca` (le solde d'un compte courant est TOUJOURS recalculé
  depuis son historique complet — tronqué, c'est un solde faux, pas un historique plus court) ; et
  l'export de cabinet, qui REFUSE désormais plutôt que de produire une archive amputée.
  Ce qui avait tranché au départ : `ClotureTab` refusait de remplir la 2035 sur une lecture
  partielle **en n'ayant vérifié QUE les pièces**, soit une entrée sur cinq. Le garde-fou promettait donc « ce
  formulaire est bâti sur tout » sans pouvoir le tenir, et une cotisation manquante donne une
  déclaration tout aussi plausible, fausse et SIGNÉE. Son drapeau s'appelle désormais
  `lectureIncomplete` et non `piecesIncompletes` : le nom mentait sur ce qu'il couvrait, et c'est
  le piège que ce fichier nomme déjà ailleurs.
  Quinze lectures portées, dans douze fichiers — dont **cinq que l'ancien scanner cachait**, quatre
  dans `ChecklistTab` (l'écran qui prétend dire ce qui MANQUE) et une dans la Balance des comptes.
  `EcrituresTab` y gagne la sienne sur `immobilisations`, qui décide quelles pièces ne doivent PAS
  produire d'écriture : tronquée, elle générait une charge sur une immobilisation — le défaut même
  que `ecrituresSansObjet` signale, mais produit par la lecture au lieu d'un geste.
  **Le critère est toujours le même, et il ne regarde pas le nombre de lignes d'aujourd'hui** :
  cette collection peut-elle grandir ? Les écritures d'UNE pièce, non — la partie double en produit
  deux ou trois. Les 43 cotisations d'un dossier, si : rien dans le modèle ne les borne. Un
  mécanisme dont la justesse dépend de la petitesse des données tombera le jour où elles
  grandissent, et c'est pour ça qu'une exception doit porter une RAISON et pas un comptage.

  **Le motif « filtre de période sur une colonne NULLABLE » est désormais borné par le SCHÉMA et
  non par un grep** : sur les quatre colonnes filtrées en `gte`/`lte` dans le code (`date_piece`,
  `date`, `echeance`, `created_at`), `pieces.date_piece` est la SEULE nullable — toutes les autres
  sont NOT NULL (vérifié dans `information_schema.columns`). Il n'y a donc que deux sites possibles,
  et tous deux sont traités.
- **Un filtre de période écarte les NULL sans le dire.** En SQL, une comparaison avec NULL n'est
  jamais vraie : `gte`/`lte` sur `date_piece` excluait donc les pièces validées sans date de
  *toutes* les périodes à la fois — absentes du ZIP, du récapitulatif et du total de chaque pack,
  invisibles partout. Un dossier réel en comptait 18 sur 22, pour 1 697,39 €. Elles sont lues par
  une requête à part et recensées dans une feuille « Pièces sans date » : on ne les rattache pas
  d'office à la période demandée (ce serait les compter dans chaque pack), on dit qu'elles
  existent et qu'il leur manque une date.
- **Un ZIP écrase sans rien dire.** JSZip ne lève rien sur un chemin déjà pris — le fichier
  précédent disparaît, simplement. Tout nom écrit dans une archive passe donc par `nomUnique`
  (`format.ts`), qui n'ajoute un suffixe qu'en cas de collision réelle. Deux cas l'ont montré :
  un nom de pièce qui ne tient qu'à la date, au tiers et au montant (un fournisseur récurrent au
  tarif fixe, dates non lues, faisait perdre 14 factures sur 17 à un dossier réel), et deux noms
  de dossiers que `slugify` réduit au même (« Café Martin » / « Cafe Martin »), qui fusionnaient
  dans l'export de cabinet. Le nom est décidé une fois pour toutes avant d'écrire, et c'est ce
  même nom que porte le récapitulatif : l'archive et l'Excel doivent désigner le même fichier.
- **Une vérification anti-doublon en base ne protège pas d'un lot parti en parallèle.** Rien
  n'est encore écrit quand toutes les branches interrogent la base, et il n'existe aucun index
  unique sur `(dossier_id, storage_hash)`. Le dépôt client (`Promise.all` dans `ClientUpload`)
  réserve donc l'empreinte dans un Set du lot *avant* toute attente — test et `add` sans `await`
  entre les deux — et la relâche si le dépôt échoue. Le cabinet, qui traite ses fichiers en
  série, peut se contenter de noter l'empreinte après écriture : même besoin, mécanique
  différente, et c'est l'ordonnancement de l'appelant qui décide laquelle est correcte.
- **Un jumeau assumé se corrige des deux côtés.** `depot.ts` (client) et `importFichiers.ts`
  (cabinet) font le même pipeline pour deux contrats différents ; chacun porte un en-tête qui
  pointe l'autre. Le nettoyage de l'orphelin a existé côté cabinet avant d'être porté ici.
- **Un paramètre par défaut est un angle mort des tests.** `capitalRestantDu` et `empruntActif`
  prenaient « aujourd'hui » en `toISOString()` — la date UTC — depuis toujours : tous les tests
  passaient une date explicite, donc ce chemin n'a jamais été exercé. Quand une fonction testée
  a une valeur par défaut, elle mérite son propre test.
- **Une lecture dont l'échec ressemble à un résultat vide se vérifie comme une écriture.**
  Un `count` nul, un `data` nul : indiscernables d'un « rien trouvé ». C'est ce qui faisait
  répondre « ce fichier est nouveau » à `fichierDejaPresent` quand la lecture était refusée,
  et abandonner silencieusement `synchroniserContrepartieBanque`.
- **Un module couplé à Supabase se teste en simulant le client**, quand il n'y a pas de calcul
  pur à en extraire : `vi.mock('./supabase', ...)` avec un faux chaînage (`from().select().eq()`)
  dont le test programme la réponse — voir `contrepartieBanque.test.ts`. **Le faux client est requis
  même pour une fonction PURE** dès lors qu'elle vit dans un module qui importe `supabase.ts` :
  l'import suffit à faire lever. Le piège est qu'un `.env` existe en local et pas en CI, donc le test
  passe ici et casse là-bas — vérifié en déplaçant `.env` avant de pousser, ce qui reproduit
  exactement les conditions du runner. C'est la voie pour
  couvrir `extraction.ts`, `importFichiers.ts`, `packGenerator.ts` et les autres.
- **Un type de `types.ts` décrit la table, colonnes NOT NULL comprises.** `TiersCategorieCabinet`
  omettait `cabinet_id` : le compilateur validait donc un payload que Postgres rejetait. Vérifier
  la table (`information_schema.columns`, `pg_constraint`) avant d'écrire le type, pas après.
  **ET LES TRIGGERS — ces deux catalogues ne suffisent pas.** Balayage du 20/09/2026, confrontant
  les 29 interfaces de `types.ts` aux colonnes NOT NULL sans valeur par défaut : **zéro défaut**,
  mais la première passe en annonçait un, et la prémisse était fausse. « NOT NULL sans `DEFAULT` »
  ne veut pas dire « l'appelant doit l'envoyer » : un trigger BEFORE INSERT est une TROISIÈME source
  de valeur, et `information_schema.columns` ne la montre pas.
  `dossiers` est la seule table du schéma à en porter, et ils remplissent exactement les deux
  colonnes concernées : `set_cabinet_id_dossier` (depuis `mon_cabinet_id()`) et
  `generate_code_email`. Tous deux écrivent **si et seulement si la valeur est nulle** — ils
  remplissent, ils n'écrasent pas, et c'est ce qui permet à une restauration de rendre un dossier à
  SON cabinet d'origine plutôt qu'à celui qui restaure. Un contrôle type ↔ schéma qui ne lit pas
  `pg_trigger` rend donc deux faux positifs, et la « correction » qu'il suggère serait une erreur.
  `Dossier` porte désormais `cabinet_id` : le type décrit la LIGNE, toute ligne le porte, et
  `sauvegardeDonnees` le lit explicitement — en l'omettant, le type faisait croire qu'un dossier
  n'appartient à personne.
- **Déployer une Edge Function via l'outil MCP décode les échappements `\uXXXX`.** La source
  envoyée passe par une couche JSON : `̀` arrive dans le fichier déployé sous forme du
  caractère réel. Le fichier du dépôt et la copie déployée diffèrent donc textuellement partout où
  le code utilise un échappement — c'est **sans conséquence**, `/[̀-ͯ]/` et la même
  classe écrite en littéral sont la même expression.
  **Ne pas essayer de « corriger » en doublant les antislashs** : ils sont transmis tels quels et
  produisent `\\u0300`, soit un antislash littéral dans la classe de caractères. Essayé, déployé,
  et `sansAccents` ne retirait plus les accents — extraction dégradée pendant quatre minutes avant
  restauration.
  **Un déploiement se vérifie, il ne se relit pas** — et il y a MIEUX que l'empreinte.
  `deploy_edge_function` rend un `ezbr_sha256`, et redéployer une source déjà déployée doit rendre
  la même : c'est bon marché, mais ça ne prouve que le DÉTERMINISME de la transformation, pas la
  fidélité de la transcription. Une transcription fautive redéployée donne deux fois la même
  empreinte.
  La vraie preuve est un ALLER-RETOUR : `get_edge_function`, puis diff contre le fichier du dépôt
  après avoir appliqué le décodage `\uXXXX` connu à la source. Zéro différence résiduelle prouve que
  les lignes retransmises sont arrivées au caractère près — fait le 21/09/2026 sur les versions 43
  puis 45 (1 278 lignes, 6 échappements décodés, zéro différence).
  **ET IL NE COÛTE RIEN : IL SE FAIT ENTIÈREMENT EN BASH.** C'est ce qui décide qu'on le fera
  vraiment à chaque fois, parce qu'une vérification chère finit par se sauter — et une
  vérification qu'on saute vaut exactement zéro. Deux chemins, aucun ne demande de retranscrire
  quoi que ce soit :
  - Un résultat d'outil trop volumineux pour la conversation est **écrit sur disque** et le message
    d'erreur en donne le chemin. `get_edge_function` sur une fonction de cette taille tombe dedans :
    le JSON s'ouvre alors en Python, et le diff se fait contre le fichier du dépôt.
  - Sinon, le **journal de session** (`~/.claude/projects/<projet>/<session>.jsonl`) porte chaque
    appel d'outil avec son entrée : on y relit le payload RÉELLEMENT transmis. Cela prouve la
    transcription et non le transport, ce qui est la moitié utile quand le transport vient d'être
    prouvé sur une autre fonction du même déploiement — à dire comme tel plutôt qu'à confondre avec
    un aller-retour complet.
  **Ce qui reste à faire AVANT d'écraser**, et qui a été sauté sur `extract-piece` le 21/09/2026 :
  comparer le DÉPLOYÉ au dépôt. Sans dégât ici (la version en place avait été vérifiée le matin même
  et personne d'autre ne déploie), mais c'est précisément le contrôle qui avait trouvé la version 42
  en retard de trois correctifs, et il ne vaut que s'il est systématique.
  **ET CET ALLER-RETOUR A TROUVÉ AUTRE CHOSE : un commit n'est PAS un déploiement.** La version 42,
  en production depuis le 20/09, était en retard de TROIS correctifs présents dans git et jamais
  déployés — le garde-fou de l'année à quatre chiffres, la lecture des douze mois français, et la
  relecture des dates sur le calendrier civil. Rien ne le signalait : les tests lisent le FICHIER DU
  DÉPÔT, pas la copie déployée, donc ils étaient verts sur du code que la production n'exécutait
  pas. Comparer le déployé au dépôt AVANT d'écraser est donc à faire à chaque déploiement, autant
  pour savoir ce qu'on embarque que pour vérifier que personne n'a modifié la production à la main.
  **ET UN DÉPLOIEMENT N'EST PAS UNE AUTORISATION** (21/09/2026, troisième membre de la même
  famille). La version 43 était juste, déployée, et vérifiée au caractère près par l'aller-retour
  ci-dessus. Le premier dépôt réel a rendu **500** : `AccessDeniedException — User
  jd-precompta-textract is not authorized to perform: textract:StartDocumentTextDetection`. La
  bascule d'`AnalyzeExpense` vers `DetectDocumentText` avait changé la **surface d'autorisation**,
  et rien dans le dépôt ne le disait : la policy IAM n'autorisait que le trio
  `AnalyzeExpense` / `StartExpenseAnalysis` / `GetExpenseAnalysis`.
  Les trois vérifications en place regardaient toutes le CODE — les tests lisent la source, le diff
  lit la copie déployée, le numéro de version dit ce qui tourne. **Aucune ne regarde ce que ce code
  a le droit de faire**, et c'est la seule chose qu'un dépôt réel pouvait montrer. Le processus n'a
  donc pas échoué : CLAUDE.md annonçait « ce qui reste est une VÉRIFICATION : un dépôt réel », et
  c'est elle qui a trouvé.
  **Dégât : nul, et la forme de l'échec est celle qu'on veut.** Le fichier était déjà déposé et la
  ligne écrite quand l'extraction a été appelée — la pièce existe, sans date ni tiers ni montant, et
  « Retrouver le texte lu » la rattrapera une fois la policy corrigée. L'étage 1 qui échoue coûte
  une saisie, pas le document.
  **Le garde-fou est `edgeFunctionsIam.test.ts`** : il balaie TOUTES les Edge Functions, lit le
  service sur l'import (`@aws-sdk/client-textract` → `textract`) plutôt que de le deviner du nom de
  la commande, et compare la surface obtenue à une liste déclarée. Toute commande ajoutée, retirée
  ou changée de service le fait virer au rouge — donc oblige à se poser la question « la policy
  autorise-t-elle celle-là ? » avant le déploiement et non après le premier 500. Deux décisions :
  **la liste attendue vit dans le TEST et non à côté de l'appel**, sinon elle serait mise à jour
  dans la même édition que l'appel, le test resterait vert et la policy resterait fausse — le
  contrôle tautologique que ce dépôt connaît déjà ; et le streaming Bedrock n'est demandé que si le
  code appelle `messages.stream`, une policy ne devant pas autoriser ce dont personne ne se sert.
  Ce qu'il ne peut PAS garder, annoncé comme pour la suppression de fichier dans `rls.sql` : **la
  policy elle-même**, qui vit chez AWS et qu'aucun fichier du dépôt ne connaît. Huit mutations
  mordent, dont le défaut d'origine replanté — la bascule complète vers le trio Expense.
- **UN BUDGET FIXE EST JUSTE TANT QUE PERSONNE NE LE DÉPASSE** (21/09/2026). Le sondage du job
  Textract asynchrone attendait 50 s, en dur, avec un commentaire qui l'annonçait « largement
  suffisant pour un document de quelques pages ». Il l'était — jusqu'au premier document qui ne
  l'était pas : un PDF déposé le jour même a rendu `Lecture trop longue` au bout de 52 s, alors que
  Textract travaillait encore. Le budget venait de la version `AnalyzeExpense` et avait traversé la
  bascule sans être reconsidéré.
  **Ce qui décide n'est pas « combien de temps on accepte d'attendre » mais « combien il reste avant
  que la plateforme ne coupe ».** Supabase arrête une Edge Function à 150 s au plan free (wall clock,
  et le même chiffre pour le délai d'inactivité, qui rend un 504) : franchir ce mur ne rend AUCUN
  message et fait perdre tout le travail, **y compris un texte OCR déjà facturé**. La borne se déduit
  donc de l'entrée dans le gestionnaire (`MUR_PLATEFORME_MS - MARGE_REPONSE_MS - BUDGET_CITATION_MS`,
  soit 110 s de lecture) et descend en paramètre, au lieu d'être reposée dans la boucle.
  **Le reste tombe du contrat des deux étages, il n'a pas été inventé pour l'occasion** : l'étage 2
  n'est TENTÉ que s'il reste son budget, et le sauter rend exactement le même objet qu'un échec
  Bedrock. Une citation coupée par le mur coûte le document entier ; une citation absente coûte une
  saisie. C'est la même phrase que l'en-tête de la fonction, appliquée au temps plutôt qu'aux pannes.
  **Et le message de dépassement était un mauvais conseil**, ce qui est pire qu'un message vague :
  « réessaie » sur un document réellement long échoue à l'identique. Il dit maintenant au bout de
  combien de secondes Textract n'avait pas fini, que le fichier est bien déposé, et les trois suites
  réelles — dont « Relire les documents », qui rejoue la lecture sans redéposer.
  `extractPieceBudget.test.ts` garde l'arithmétique et la forme ; sept mutations mordent, dont le
  délai fixe replanté. Ce qu'il ne peut pas garder : la valeur du mur chez Supabase, qui dépend du
  plan — passer au plan payant le porte à 400 s et demandera de modifier ce test sciemment.
- **`npx tsc --noEmit` ne vérifie rien dans ce dépôt.** Le `tsconfig.json` racine a
  `"files": []` et ne fait que référencer `tsconfig.app.json` / `tsconfig.node.json` : lancé
  seul, `tsc --noEmit` sort silencieusement sans avoir typé une seule ligne, ce qui ressemble
  exactement à un typecheck réussi. La commande réelle est **`npx tsc -b`** (ce que fait
  `npm run build`). Un identifiant non importé est passé trois fois de suite à travers ce faux
  contrôle — c'est `oxlint` (`react(jsx-no-undef)`) qui l'a rattrapé.
- **La chaîne vers l'écriture comptable a DEUX portes, pas une.** Une pièce ne génère une écriture
  que si elle a une `categorie_id` **et** que cette catégorie porte un `compte_comptable`
  (`lignesChargeProduitPourPiece` l'exige en paramètre). Une troisième porte, `poste_2035`, commande
  les totaux de Clôture et donc la 2035. Constaté en production : 23 pièces catégorisées à la main
  ne produisaient rien parce que « Honoraires » n'avait pas de compte — le travail était fait et
  invisible. **Diagnostiquer les trois portes ensemble**, jamais la première seule.
  **Et les trois sont gardées par un contrôle, désormais.** `categoriesSansCompte` et
  `categoriesSansPoste` (lib/controles.ts) couvraient les portes 2 et 3 ; toutes deux partent d'une
  catégorie et cherchent ce qui lui manque, si bien qu'une pièce dont `categorie_id` est **nul** leur
  était invisible — il n'y a pas de catégorie à inspecter. Le résultat est pourtant identique : ni
  écriture, ni ligne de 2035. `piecesValideesSansCategorie` ferme la porte 1, signalé dans Écritures,
  Clôture et la Checklist. Trouvé en production : 11 pièces validées sans catégorie sur deux dossiers.
  C'est la plus coûteuse des trois, parce que la pièce a l'air traitée — le cabinet a écrit
  « validée » dessus, donc plus personne ne la regarde. Le contrôle ne vise QUE les validées : une
  pièce « à valider » sans catégorie est la corbeille d'arrivée, et le même dossier en portait 30
  face à 10 — les signaler noierait le signal.
- **Un contrôle qui part d'un côté d'une relation ne voit pas ce qui manque de l'autre.** C'est
  désormais la TROISIÈME fois que ce motif frappe, toujours de la même façon : `categoriesSansCompte`
  partait de la catégorie et ne voyait pas la pièce sans catégorie ; `analyserEcritures` part de la
  PIÈCE — sa boucle commence par `if (!e.piece_id) continue` — et ne voit donc pas l'écriture sans
  pièce. Les trois contrôles du brouillon sont aveugles au même objet, en même temps, parce qu'ils
  partagent ce regroupement.
  **Observé en base** : une écriture de 199,99 € (606100, « BOULANGER MARSEILLE ») n'a plus de
  `piece_id`. Deux pièces du même fournisseur existaient, une a été supprimée — et les deux clés
  étrangères d'`ecritures_brouillon` sont en `ON DELETE SET NULL`, donc Postgres a effacé le lien
  sans un mot. **Ce cas est dans `deltasoins 10`, un dossier abandonné, sur des données fictives**
  (voir « État des données » plus haut) : ce qu'il démontre est le MÉCANISME, pas un préjudice
  comptable. Le dossier `test` ne porte aucune écriture, donc aucune rupture — un contrôle qui ne
  trouve rien là où il n'y a rien fait exactement son travail. Le projet CONNAISSAIT ce piège (voir la règle `ON DELETE SET NULL` plus bas, écrite
  pour la sauvegarde) ; il ne l'avait pas vu se réaliser dans la comptabilité.
  **La conséquence est une incohérence entre deux livrables** : `calculerBalance` regroupe par COMPTE
  et compte donc cette charge ; `genererFec` fait le même `if (!e.piece_id) continue` et l'exclut —
  ce qui est le bon choix, inventer une référence de pièce serait pire. La Balance des comptes et le
  fichier fiscal annoncent donc deux résultats différents, sans que rien le dise.
  `rupturesPisteAudit` (lib/pisteAudit.ts) ferme l'angle mort en partant de l'ÉCRITURE, et
  `absenceFec` chiffre exactement ce que le FEC ne contiendra pas. Le format FEC étant rigide, ce
  livrable incomplet ne peut se déclarer que sur l'écran qui l'engendre — pas dans le fichier, à la
  différence du pack Excel et de sa feuille « Pièces manquantes ».
  **Ce que ce contrôle ne fait PAS, délibérément** : il ne signale pas « l'écriture désigne une pièce
  absente du jeu fourni ». `EcrituresTab` ne charge que les pièces VALIDÉES, donc une pièce repassée
  « à valider » ferait crier au loup sur un artefact de filtrage. Seul `piece_id` nul est retenu,
  parce qu'il ne dépend d'aucun jeu de données à côté.
  **QUATRIÈME FRAPPE, LE 20/09/2026, ET PAR UN AUTRE MÉCANISME** — trouvée en ouvrant `EcrituresTab`
  pour lui écrire un test de rendu, pas en cherchant ce motif. Une écriture peut rester
  PARFAITEMENT FORMÉE alors que sa pièce ne la justifie plus, et les trois contrôles la manquent
  alors chacun pour sa propre raison : les deux premiers ne jugent que la FORME du groupe
  (contrepartie présente, solde nul), et ce groupe-là est complet et équilibré ; le troisième juge
  bien la pièce, mais en partant de la liste ÉLIGIBLE — dont elle vient précisément de sortir.
  Le chemin naturel des gestes l'amène : on valide, on catégorise, on génère, PUIS on découvre en
  ouvrant Immobilisations que cet achat est un actif. Rien ne retire l'écriture (aucun code du dépôt
  n'écrit dans `ecritures_brouillon` hors `EcrituresTab` et `contrepartieBanque`).
  **Et le dégât exact n'est PAS celui qu'on croit d'abord** — écrit faux au premier jet, vérifié
  ensuite : la 2035 se calcule sur les PIÈCES et exclut déjà les immobilisées
  (`declaration2035.ts`), elle est donc juste. Ce sont le FEC et la Balance des comptes, calculés
  sur le BROUILLON, qui portent la charge entière. Les deux livrables décrivent alors deux résultats
  différents pour le même euro, et rien ne le dit — exactement l'incohérence que le cas `piece_id`
  nul a déjà coûtée. Annoncer « compté deux fois dans la 2035 » aurait envoyé chercher un défaut qui
  n'existe pas.
  `ecrituresSansObjet` (lib/ecritures.ts) part de l'ÉCRITURE et nomme le motif — immobilisée,
  catégorie retirée, catégorie sans compte, montant effacé — parce que l'action n'est pas la même
  (les trois derniers se réparent en amont puis « Régénérer » ; le premier demande de retirer
  l'écriture, et « Régénérer » y serait activement FAUX, il réécrirait la charge).
  **ET CE GESTE-LÀ N'EXISTAIT PAS** — corrigé le 20/09/2026. Le panneau NOMMAIT l'action, « Retirer
  l'écriture », et aucun écran de l'application ne pouvait la faire : il montrait une incohérence
  entre le FEC, la balance et la 2035 en laissant l'opérateur sans moyen de la lever.
  **Le retrait emporte TOUTES les lignes de la pièce, contrepartie banque comprise, et c'est la
  seule forme correcte.** N'ôter que la charge — en copiant le `.neq('compte', COMPTE_BANQUE)` de
  `regenererEcriture`, qui est juste POUR LUI — laisserait la ligne banque SEULE dans son groupe :
  un groupe qui porte bien une contrepartie et dont le solde ne vaut pas zéro, c'est-à-dire
  exactement ce que `groupesDesequilibres` signale, et que plus aucun geste ne pourrait éteindre. On
  échangerait une alerte vraie contre une alerte fausse et DÉFINITIVE. Vérifié en posant la mutation,
  pas déduit : le panneau « Écritures déséquilibrées » apparaît bel et bien.
  **Réservé au motif `immobilisee`**, délibérément : pour les trois autres, l'écriture DOIT revenir
  une fois la pièce corrigée en amont, et un bouton « Retirer » y ferait disparaître une charge
  réelle d'un clic, sans trace — que personne ne chercherait, le panneau étant alors vide.
  **Ce que le retrait laisse, et qui est écrit plutôt que tu** : l'application ne modélise AUCUNE
  écriture d'acquisition (aucun compte de classe 2 sur `natures_immobilisation`, vérifié en base),
  donc le FEC ne portera pas cet achat. C'est un manque pré-existant, et il est moins faux que la
  charge : après retrait, le FEC, la balance et la 2035 écartent tous les trois la pièce et disent
  enfin la même chose, la dépense restant comptée par l'amortissement. La piste d'audit, elle,
  continue de la voir — en justificatif validé que rien ne comptabilise, ce qui est la vérité.
  Pas de verrou `useRef` : une suppression est idempotente, deux clics retirent les mêmes lignes.
  **Le faux client du test SUPPRIME vraiment**, donc le `load()` qui suit relit un jeu réellement
  amputé : les assertions portent sur ce que l'écran montre APRÈS, pas sur la méthode appelée — c'est
  ce qui permet de voir qu'une ligne oubliée en allume une autre ailleurs. Quatre mutations mordent.
  **Piège d'assertion à connaître pour le prochain test d'écran** : `queryByText` LÈVE quand
  plusieurs éléments correspondent, au lieu de rendre `null`. Une absence qui pourrait être multiple
  se vérifie donc par `queryAllByText(...).toHaveLength(0)` — sinon l'échec s'affiche en « Found
  multiple elements », qui ne ressemble pas au défaut gardé.
  **ET LE MÊME BALAYAGE EN A SORTI UN SECOND, PLUS PROBABLE** : `piecesDesynchronisees` ne comparait
  que le MONTANT. Recatégoriser une pièce déjà validée est un geste courant, et rien ne réécrit son
  écriture : elle reste sur l'ancien compte. Or le total ne bouge pas d'un centime — le contrôle
  déclarait donc « synchronisée » une écriture qui part en FEC sur un compte que la pièce ne désigne
  plus, pendant que Clôture et la 2035 lisent le `poste_2035` de la catégorie ACTUELLE. Deux
  livrables, deux réponses, aucun signal : exactement l'incohérence que le cas `piece_id` nul avait
  déjà coûtée. Les comptes de TVA sont exclus de la comparaison, sinon toute facture au taux normal
  serait signalée dès la première.
  **Les deux sont LATENTS, mesuré le 20/09/2026, et c'est un résultat à garder** : deux
  immobilisations en base, aucune ne portant d'écriture de charge ; et zéro écriture sur un compte
  différent de celui de la catégorie actuelle de sa pièce. Ce qui les rend dignes d'être corrigés
  n'est donc pas un préjudice constaté, c'est qu'aucun des deux ne PEUT se voir une fois arrivé.
  **La règle d'éligibilité était écrite DEUX FOIS, à l'identique**, dans `EcrituresTab` et
  `ChecklistTab` — elle remonte dans `piecesAComptabiliser`, qui rend aussi le compte attendu. Une
  règle recopiée deux fois n'attend pas de diverger, elle attend un troisième appelant.
  **Et ma propre explication du défaut était fausse au premier jet** : j'avais écrit que « les trois
  contrôles partent de la pièce éligible ». C'est le TEST D'ÉCRAN qui l'a démenti, en échouant sur
  un badge que je croyais muet — `nbSansContrepartie` et `groupesDesequilibres` partent des
  écritures, pas de la liste éligible. La conclusion tenait, la cause non ; seule une exécution l'a
  montré.
- **Une piste d'audit se PRODUIT, elle ne se contrôle pas seulement.** Les contrôles ci-dessus disent
  qu'il y a une rupture ; ce qu'un vérificateur demande est un fichier : chaque écriture avec son
  justificatif (tiers, date, montant, nom du fichier, empreinte SHA-256) et l'opération bancaire
  réelle, de façon continue et chronologique. `pisteAudit` + `genererPisteAuditCsv`
  (lib/pisteAudit.ts), exporté depuis Écritures à côté du FEC. Cinq décisions le rendent utilisable :
  - **Une seule table, les deux sens dedans** — une ligne par écriture, PLUS une ligne par
    justificatif validé qu'aucune écriture ne cite (`manque: ['écriture']`). Deux listes séparées ne
    se recoupent jamais ; c'est la leçon du contrôle qui ne voit qu'un côté d'une relation, appliquée
    au livrable cette fois.
  - **L'empreinte est la preuve, pas le nom du fichier.** Un nom se change, un SHA-256 non. Nul sur
    les pièces d'avant le champ — la colonne est alors VIDE, jamais remplacée par le nom du fichier :
    ce serait laisser croire à une preuve d'intégrité qui n'existe pas.
  - **Une colonne vide ne s'explique pas toute seule** : la colonne `manque` nomme le trou en clair,
    et distingue « le lien est nul » (rupture comptable) de « hors du jeu chargé » (filtre de
    l'appelant). Confondre les deux ferait passer un artefact de chargement pour une charge sans
    justificatif — l'erreur qui rend un avertissement inécoutable.
  - **Une pièce sans date apparaît dans l'export de CHAQUE exercice**, avec `date` dans `manque` :
    elle n'appartient à aucun, l'attacher à un seul serait faux et la taire serait pire (même
    arbitrage que la feuille « Pièces sans date » d'un pack).
  - **L'export relit les mouvements bancaires en entier sur ce clic.** `EcrituresTab` garde en état
    un jeu restreint (rapprochées, portant une pièce) dont la génération a besoin ; une piste bâtie
    dessus annoncerait manquants des mouvements qui existent.
  Mesuré sur le dossier `test` le 19/09/2026 : 11 justificatifs validés pour 1 387,15 € que rien ne
  comptabilise, tous porteurs de leur empreinte, dont 10 sans catégorie — l'export ne découvre donc
  pas un défaut de plus, il pointe la porte 1 déjà connue, ce qui est le signe qu'il dit vrai.
- **Le premier export CSV de l'application pose deux règles pour les suivants.** Un BOM UTF-8 en
  tête, sans quoi Excel en français ouvre le fichier en CP1252 et « Libellé » devient « LibellÃ© » —
  sur un fichier qu'un vérificateur relit, un accent cassé à chaque ligne jette le doute sur le
  reste. Et tout champ passe par `champCsv` : sauts de ligne aplatis, guillemets doublés,
  point-virgule protégé. Un libellé OCR porte les trois, et un seul `;` non protégé décale toutes
  les colonnes suivantes sans que rien ne le signale (même piège que le FEC). Un test vérifie que
  chaque ligne du fichier porte exactement autant de colonnes que l'en-tête, avec un découpage qui
  respecte les guillemets — pas le même `split(';')` que celui qu'on cherche à mettre en défaut.
- **Une valeur par défaut connue s'applique, elle ne s'affiche pas en attendant un clic.**
  `SUGGESTIONS_COMPTE_PAR_CODE` (lib/ecritures.ts) portait depuis le début les bons comptes PCG et
  postes 2035, mais seulement comme pré-remplissage d'un champ à valider catégorie par catégorie.
  Résultat : 8 catégories sur 9 sans compte, et toute la comptabilité bloquée en aval. L'application
  vise un cabinet qui veut réduire sa saisie : ce qui est connu est appliqué, l'utilisateur vérifie
  et corrige. Un champ vide qui fait disparaître des pièces en silence est pire qu'un défaut
  modifiable — c'est pour ça que « Autre » a aussi reçu un compte (628000 / Divers).
- **Un nom qui ment sur son filtre est un piège qu'aucun contrôle ne rattrape.** Six écrans
  déclaraient un état `pieces` qui ne portait QUE les pièces validées (`.eq('statut', 'validee')`),
  pendant que six autres en déclaraient un, du même nom, qui portait tout. Le même identifiant
  signifiait donc deux choses selon le fichier, et rien ne le disait. **Vécu le 19/09/2026** :
  `moisEnDoubleSurAbonnement` a été branché sur `pieces` dans `ChecklistTab` par réflexe — or les
  deux pièces du cas réel sont « à valider », donc le contrôle serait resté muet sur le cas même
  qu'il est fait pour voir. Rattrapé par hasard, en relisant le chargement.
  Les six portent désormais `piecesValidees`, et les deux écrans qui restreignent en plus au type
  vente portent `recettesValidees` (Estimation, simulation client). Le pire était
  `EstimationTab.piecesToutes`, dont le nom affirmait l'inverse de sa requête.
  **Un piège qu'un nom supprime vaut mieux qu'un piège gardé par un contrôle** : le compilateur
  vérifie un renommage de façon exhaustive, là où un contrôle ne voit que ce qu'on a pensé à lui
  montrer. Règle qui en découle : un état qui porte un sous-ensemble dit lequel dans son nom.
  **UN SEPTIÈME ÉCRAN AVAIT ÉCHAPPÉ AU RENOMMAGE** (trouvé et corrigé le 20/09/2026, par balayage).
  `ImmobilisationsTab` déclarait `pieces` sur une lecture `.eq('statut', 'validee')`, et cette liste
  sert à choisir les CANDIDATES à immobiliser. Le filtre est juste — on immobilise une facture
  vérifiée, pas une pièce en attente d'arbitrage — c'est le nom qui mentait, et il aurait menti au
  prochain contrôle qu'on y aurait branché.
  **Le balayage vaut plus que la prise, et il est simple** : toute lecture portant `.eq('statut', …)`
  ou `.in('statut', …)`, confrontée au nom de l'état qu'elle alimente. Douze lectures dans le code,
  une seule en faute ; les onze autres portent `piecesValidees`, `piecesAValider`, `recettesValidees`
  ou `piecesRapprochees`. À rejouer avant de croire le motif épuisé — et à ne PAS élargir aux filtres
  `dossier_id`/`cabinet_id`, qui sont le cadrage d'un écran et non une restriction : les signaler
  tous noierait le signal (la première version du balayage le faisait, et rendait quatorze lignes
  dont aucune n'était un défaut).
- **Un verrou d'exécution est un `useRef`, jamais un état React.** `setRunning(true)` ne prend
  effet qu'au rendu suivant : `disabled={running}` laisse donc passer deux clics rapprochés, et
  les deux entrent dans le traitement. Sur l'import en masse, chacun repartait avec **son propre**
  ensemble d'empreintes (`chargerHashsExistants` est appelé une fois par exécution) : deux boucles
  parallèles aveugles l'une à l'autre. Constaté sur un import réel — **141 lignes pour 78
  fichiers**, le dédoublonnage ne rattrapant que les paires où le minutage jouait en sa faveur.
  Poser le verrou dans un ref, **avant le premier `await`**. Même famille que la réservation
  avant `await` du dépôt parallèle.
  **Les deux relectures OCR portaient le même défaut** (PiecesTab et DocumentsTab), et là le double
  clic ne duplique pas des lignes : il paie deux fois les mêmes appels Textract sur les mêmes
  fichiers. Corrigé des deux côtés le 19/09/2026 — chercher toutes les copies avant de corriger la
  première, c'est la règle qui vaut ici aussi.
  **Le verrou se pose AVANT le `try`, jamais dedans**, et il faut TROIS clics pour le voir. Placé
  dans le `try`, le refus du deuxième clic sort par son `return`, donc par le `finally` — qui
  relâche le verrou du PREMIER, encore en cours. Le troisième passe alors, et le défaut revient
  entier. Avec deux clics la version fautive paraît correcte : c'est une mutation qui a survécu au
  premier jeu de tests, pas une relecture, qui l'a montré.
  **Les porteurs se recensent ici, et un ordinal dispersé ne tient pas.** Deux sessions travaillant
  en parallèle le 20/09/2026 ont écrit « troisième » et « cinquième » pour ce motif dans ce fichier.
  Un rang inscrit au fil du texte oblige à recompter à chaque ajout, sur des paragraphes que
  personne ne relit ensemble : la liste vit donc en un seul endroit, celui-ci.
  **Dix fois trouvé à ce jour** — `ImportDossierModal` (import en masse), les deux relectures OCR
  (`PiecesTab` et `DocumentsTab`), « C'est une facture » (`DocumentsTab`, qui n'avait aucun verrou),
  « Tout rapprocher automatiquement » (`BanqueTab`), puis quatre trouvés d'un coup par l'audit
  ci-dessous (20/09/2026) : `EnvoyerEmailModal.envoyer`, `SuperPdpFactureModal.appeler`,
  `FactureAvoirModal.creerAvoir` et `PieceFormModal.save`. **`AccesTab.handleCreateAccess`
  s'ajoute le 24/09/2026** — trouvé en fermant un des huit onglets encore sans test de rendu, pas
  par un nouveau balayage : il figurait pourtant déjà parmi les 36 candidats du balayage ci-dessous
  (`functions.invoke` sans `.current`), classé avec les 32 laissés de côté comme « leur doublon crée
  une LIGNE, qu'un cabinet voit et supprime ». Ce classement était faux pour celui-là : la ligne
  `memberships` est protégée par une contrainte unique (la fonction la détecte et rend 409), donc le
  doublon ne crée pas de ligne en trop — il fait courir deux appels `auth.admin.createUser` pour la
  même adresse, avec au bout un message d'erreur qui laisse croire à un échec alors que l'accès vient
  d'être créé par l'autre requête. Un candidat écarté par la classification du balayage reste donc un
  candidat à revérifier au cas par cas, pas un candidat clos.
  **CE MOTIF SE CHERCHE, IL NE S'ATTEND PAS.** Les cinq premiers ont été trouvés un par un, en
  travaillant sur autre chose. Un balayage a rendu les quatre suivants en une fois, et la requête
  vaut plus que la prise — à rejouer avant de croire le motif épuisé : les gestionnaires `async` qui
  **dupliquent** quelque chose (`.insert(`, `functions.invoke`, `storage…upload`) et ne portent
  aucun `.current`. Écarter `.update(`/`.delete(` est ce qui rend la liste lisible : une mise à jour
  idempotente suivie d'un `load()` ne coûte rien en double, et les signaler tous noierait le signal.
  Le balayage rend **36 candidats**, dont ces quatre. **Les 32 autres ne sont pas corrigés**, et
  c'est un choix, pas un oubli : leur doublon crée une LIGNE, qu'un cabinet voit et supprime. Les
  quatre retenus sont ceux dont le doublon ne se rattrape pas — un e-mail parti chez le client, une
  facture transmise deux fois à une plateforme agréée DGFiP, un numéro consommé dans une suite
  légale qui n'admet ni trou ni doublon, et une pièce en double, c'est-à-dire une charge comptée
  deux fois en 2035 comme en balance.
  **Et le formulaire est le pire déclencheur, pas le double clic.** `EnvoyerEmailModal` soumet un
  `<form>` : deux « Entrée » rapprochés suffisent, geste bien plus banal que deux clics.
  **Et porter un verrou n'est pas la même chose qu'avoir porté le défaut** — c'est ce qui a fait
  écrire « six » à la première tentative de ce recensement. Onze `useRef` de verrouillage existent
  dans `src`, et six sont nés corrects avec leur fonctionnalité (`VehiculesCard`, `ClotureTab`,
  `SauvegardeCard`, `RestaurationCard`, `FilCommentaires`, et le `validerEtRapprocherLot` de
  `BanqueTab` — vérifié par `git log -S` sur chaque fichier, pas par relecture). Compter les verrous
  surestime donc le défaut ; c'est la liste ci-dessus qui fait foi. Le motif n'est pas épuisé pour
  autant : chercher toutes les copies avant de corriger la première vaut aussi pour celui-là.
  **« C'est une facture » (DocumentsTab) n'avait, lui, AUCUN verrou.** Il recrée une pièce à partir d'un document déjà en stockage puis supprime
  le document ; deux clics créaient donc deux pièces sur le même fichier. Et rien ne les rattrapait :
  **le dédoublonnage par empreinte porte sur un fichier DÉPOSÉ**, or ici aucun fichier n'est envoyé —
  la pièce reprend le `storage_path` du document. Un fichier qui change de table échappe à toute la
  chaîne anti-doublon du dépôt ; seule l'empreinte du TEXTE finirait par le signaler, après coup.
  Le verrou y est **par document** et non global : convertir deux documents à la suite est un geste
  normal, et un verrou global aurait transformé le second clic en silence.
  Deux autres défauts dormaient dans la même fonction, tous deux de familles déjà connues du projet.
  La **suppression du document n'était pas vérifiée** alors que la pièce, elle, est déjà créée : en
  cas d'échec le même fichier vivait des deux côtés, et le réflexe — recliquer — ajoutait une pièce
  à chaque fois. Elle se dit maintenant, en nommant ce qui est fait et ce qui reste à faire à la
  main. Et la **lecture du texte OCR ravalait son erreur** : « ce document n'a pas de texte » et
  « la lecture a été refusée » rendent tous deux `null`, alors que le second veut dire qu'un texte
  existe peut-être et qu'on s'apprête à l'effacer — dans la fonction même dont le commentaire
  rappelle qu'elle lit le texte AVANT de supprimer pour ne pas le perdre. D'où
  `lireTexteOcrDuDocument`, qui rend l'erreur, et le refus de convertir tant qu'on n'a pas pu lire.
- **Une date de pièce postérieure à aujourd'hui est impossible, pas improbable.** Ce qu'on lit
  alors est une validité, une échéance ou une fin de droits. Le refus vit dans `toIsoDate`
  (extract-piece), avec un jour de marge pour l'écart UTC/Paris. Le placer là et non dans la règle
  de repli est délibéré : la date fautive venait du champ étiqueté par Textract, qui rejoint
  `parseDate` **sans** passer par la fenêtre `a > anneeReference + 1` de `datesDeLaLigne`. Deux
  chemins mènent à une date, un seul contrôle les couvre tous les deux.
- **Le dernier recours de `parseDate` est corrigé (20/09/2026), et il ne « ignorait » pas les mois
  français — il en lisait CINQ.** `new Date()` reconnaît un mois à ses trois premières lettres en
  ANGLAIS : janvier→jan, mars→mar, septembre→sep, octobre→oct, novembre→nov tombaient donc juste par
  collision, et les sept autres rendaient `null`. **L'accent suffisait à faire basculer** :
  « decembre » était lu, « décembre » perdu. Une lecture juste cinq fois sur douze selon une règle
  que personne ne peut deviner est pire qu'une qui échoue toujours — elle n'a pas l'air cassée. D'où
  un test sur les DOUZE mois : un test sur le seul « 30 juin 2025 » du cas d'origine serait passé au
  vert avec une correction ne traitant que juin, et un test sur « mars » était vert AVANT correction.
  Ce chemin compte plus que son nom ne le dit : c'est celui de la date **étiquetée par Textract**,
  donc le signal le plus fiable. Rendre `null` ne perdait pas toujours la date (le repli sur texte
  brut la retrouve souvent) mais la rétrogradait en déduction « à vérifier », ou la perdait pour de
  bon quand le repli hésitait entre plusieurs candidats.
  Second défaut, corrigé aussi : `new Date(texte).toISOString()` lisait minuit **local** en UTC, donc
  reculait d'un jour à l'est de Greenwich. Mesuré : « 27 August 2026 » rendait 2026-08-26 sous
  Europe/Paris et Pacific/Auckland, 2026-08-27 sous UTC et America/New_York. La date se relit
  maintenant sur le calendrier civil (`getFullYear`/`getMonth`/`getDate`) via `toIsoDate`.
  **Et la mutation de ce second défaut est INVISIBLE sous UTC** — donc invisible pour un runner
  GitHub, qui est en UTC. Vérifié en la posant : verte sous UTC et America/New_York, rouge sous
  Europe/Paris et Pacific/Auckland. C'est `npm run test:fuseaux` (que `tests.yml` lance, et pas
  `npm test`) qui porte seul cette garantie.
- **`dateFuture` compare des CHAÎNES, donc `toIsoDate` doit garantir une année à quatre chiffres.**
  Trouvé en écrivant le test ci-dessus, pas cherché : `new Date()` lit « facture 12345 » comme le
  1er janvier de l'an 12345, et le refus du futur ne l'arrêtait pas — `'12345-01-01' > '2026-09-21'`
  est **faux**, le premier caractère décidant ('1' < '2'). Un numéro de facture ressortait donc en
  `+012345-01` : la forme ISO à année étendue de `toISOString()`, tronquée à dix caractères,
  c'est-à-dire une chaîne qui n'est plus une date, écrite telle quelle dans `pieces.date_piece`.
  Le garde-fou vit dans `toIsoDate` et non dans la branche qui l'a révélé, parce que les trois
  chemins de `parseDate` ET `datesDeLaLigne` y passent tous — le posant ailleurs, les autres
  resteraient ouverts. C'est la même leçon que « deux chemins mènent à une date, un seul contrôle
  les couvre tous les deux », appliquée une fois de plus.
- **UNE CONTRAINTE JUSTIFIÉE PAR UN APPELANT DEVIENT FAUSSE QUAND CET APPELANT DISPARAÎT — ET SON
  COMMENTAIRE, LUI, GARDE L'AIR D'ÊTRE VRAI** (`parseDate`, corrigé le 21/09/2026). Ses branches sont
  ANCRÉES (`^`), et le commentaire qui l'expliquait disait vrai de son époque : « Textract rend la
  VALEUR du champ, pas la ligne ». `AnalyzeExpense` était alors le seul appelant.
  **Depuis la marche 1, il n'en reste AUCUN** : `parseDate` a un unique appelant, la CITATION d'un
  modèle à qui l'on demande explicitement de recopier la chaîne **telle qu'imprimée**, donc plus
  longue et plus bavarde que la valeur d'un champ. L'ancrage ne bornait donc plus une ligne, il
  faisait PERDRE la date.
  **Deux citations sur 42 du corpus réel étaient perdues**, et les deux pour cette raison :
  `« mercredi 23 juillet 2025 »` (nom du jour devant) et `« jeu. 12 juin 25 00:10 »` (nom du jour
  abrégé **et** année sur deux chiffres, que la branche « mois français » exigeait à quatre alors que
  la branche numérique les admet depuis toujours). Le dégât n'est pas toujours la perte : le repli sur
  texte brut rattrape souvent, mais RÉTROGRADE la date en déduction « à vérifier » — le coût déjà
  nommé plus haut pour les douze mois français.
  **CE DÉFAUT VIVAIT DANS UNE PHRASE DE CE FICHIER, ÉCRITE COMME UN ARGUMENT RASSURANT.** Il y était
  écrit que `« mercredi 23 juillet 2025 »` contre `« 23/07/2025 »`, c'était « deux branches de
  `parseDate`, même date » — donné comme preuve que les deux modèles s'accordaient. Exécuté,
  `parseDate` rend `null` sur le premier. La phrase avait été écrite par RELECTURE, et elle
  transformait un défaut en argument.
  **LA MESURE A CORRIGÉ L'INTUITION DEUX FOIS, ET LA SECONDE EST LA LEÇON.** Première correction :
  j'allais ne traiter que le nom du jour, seul cas observé. Un comptage en base dit que sur 42 textes
  portant une date en toutes lettres, **31 la font précéder de « le »** et **1 d'un nom de jour** —
  donc « corriger ce qui est mesuré » ratait 31 cas sur 32. Seconde correction, qui annule la
  première : ce comptage portait sur ce que les documents **impriment**, et ce qui décide est ce que
  le modèle **cite**. Sur les 42 dates citées, **ZÉRO porte « le »** (le modèle le laisse au document)
  et **DEUX portent un nom de jour** — exactement les deux perdues. La première mesure avait tout
  l'air de la rigueur et répondait à une autre question.
  **Les jours sont NOMMÉS un par un**, abrégés compris (`JOUR_SEMAINE`), jamais « des lettres avant le
  quantième » : cette forme-là ferait de « facture 12 juin 25 » une date, c'est-à-dire la valeur
  plausible et fausse que tout le contrat de citation existe pour empêcher. Un test garde ce risque
  symétrique, comme pour `MOTS_SANS_IDENTITE`. Quatre mutations mordent.
  **Le retrait se fait AVANT toutes les branches** et pas seulement devant celle qui a révélé le
  défaut — sinon `« vendredi 23/07/2025 »` resterait ouvert. Encore « deux chemins mènent à une date,
  un seul contrôle les couvre tous les deux ».
  **`DATE_TEXTUELLE_REGEX` n'est PAS étendue aux années à deux chiffres, et c'est délibéré** : elle
  BALAIE un document entier, là où `parseDate` reçoit UNE valeur désignée. Les deux n'ont pas le même
  droit à l'erreur, et élargir un scanner sur du texte libre est ce qui a déjà failli supprimer
  32 encaissements CPAM (voir `soldesDuPdf`).
  **Et le NOM du bloc de tests mentait aussi** : « date étiquetée par Textract (parseDate) », pour une
  fonction que Textract n'appelle plus. C'est ce nom resté en place qui a rendu le changement de
  contrat invisible — le piège que ce fichier nomme déjà sous « un nom qui ment sur son filtre ».
- **Une recherche filtre l'affichage, jamais un total.** Une barre de recherche réduit les
  lignes visibles ; les montants calculés à côté (TVA déductible/collectée, total appelé/versé,
  total prélevé) restent sur l'ensemble filtré par l'exercice, et un export (FEC) reste sur cet
  ensemble aussi — sinon le fichier fiscal part amputé des lignes ne correspondant pas au texte
  tapé. La Balance des comptes violait la règle : ses totaux débit/crédit portaient sur les
  lignes trouvées, donc taper « 606 » affichait le badge rouge « écart … », celui qui signale
  normalement un brouillon cassé. Une recherche ne doit jamais fabriquer une alerte.
  **ET ELLE A ÉTÉ VIOLÉE UNE SECONDE FOIS, DANS L'AUTRE SENS** (20/09/2026) — sur la liste des
  dossiers, le seul écran du projet à porter sur tout le cabinet. `nbAvecAlerte` était calculé sur
  l'ensemble d'APRÈS-recherche et servait trois chiffres rendus AU-DESSUS de la liste : la tuile
  « À régler », qui passait au vert avec « aucun point ouvert » sur une recherche sans résultat ; la
  tuile « À jour », valant `dossiers.length - nbAvecAlerte`, donc un MÉLANGE des deux ensembles — si
  bien que plus la recherche restreignait, plus ce chiffre MONTAIT ; et le sous-titre des priorités,
  qui listait cinq dossiers en annonçant « 0 dossier(s) avec un point ouvert ».
  **Ce qui le rendait invisible** : « À régler » et « À jour » totalisaient toujours « Dossiers
  suivis ». Les deux tuiles restaient cohérentes ENTRE ELLES tout en étant fausses toutes les deux.
  Et là où la Balance fabriquait une ALERTE, celui-ci fabriquait une BONNE NOUVELLE — c'est le pire
  des deux, personne n'allant vérifier une bonne nouvelle.
  **LA RÈGLE NE RESTE PLUS DANS CE FICHIER : elle est devenue un test** (`recherchesEtTotaux.test.ts`).
  Il part de `correspondALaRecherche(`, lie chaque appel au `.filter(` qui l'ENFERME par comptage de
  parenthèses, et interdit trois formes sur l'ensemble ainsi lié : `X.reduce(`, `X.filter(…).length`
  et `total={X.length}`. Ce qui reste légitime passe — `X.map(…)`, `X.length === 0`, `[...X].sort(…)`
  et surtout `affiches={X.length}`, qui DOIT suivre la recherche. Deux décisions à ne pas défaire :
  - **Il ne part PAS de `BarreRecherche`.** Première version envisagée : lire `affiches={X.length}`,
    l'écran DÉCLARANT ainsi son ensemble d'après-recherche. Simple, exacte, et elle aurait manqué le
    seul défaut réel du dépôt — la liste des dossiers porte un `<input>` à elle, pas le composant
    partagé. Un scanner qui rate la prise qui l'a fait naître est la panne déjà connue ici.
  - **Une forme non reconnue le fait ÉCHOUER, jamais passer.** Sans quoi « zéro faute » et
    « aveugle » redeviennent indiscernables.
  Le comptage de parenthèses n'est pas du zèle : un `const` local DANS le corps du filtre
  (`ClientUpload` en porte un) met en défaut la version naïve qui remonte au `const` le plus proche.
  **Sa mutation a pourtant SURVÉCU d'abord**, et c'est le jeu d'essai qu'il fallait accuser, pas le
  code : le cas « forme non reconnue » était un one-liner sans rien au-dessus, donc sans rien de faux
  à attraper. Remis dans la forme qui l'aveugle — un `.filter` sans rapport juste avant — il mord.
  **Balayage complet du 20/09/2026, résultat à garder** : onze écrans portent une recherche, un seul
  était en faute ; les dix autres calculent bien leurs totaux sur l'ensemble d'avant.
  **Et un scanner de source ne prouve que la FORME** : `valeur={filtered.length - nbAvecAlerte}` lui
  échapperait, `filtered.length` étant par ailleurs légitime. D'où `DossiersList.test.tsx`, qui tape
  un nom et vérifie que le tableau de bord ne bouge pas — quatre mutations mordent, dont celle-là.
- **Le compteur « N sur M » compare ce qui est comparable.** `M` est l'ensemble après les
  filtres de l'écran (statut, année, mois) et avant la recherche — pas la liste brute, sinon le
  compteur annonce un écart dû au filtre Année et non à la recherche.
- **Sur la 2035-A, une case n'appartient pas à la ligne en face de laquelle elle est imprimée.**
  Les lignes 17, 18, 20, 21, 22, 23, 24, 26, 27, 28 et 30 n'ont aucune case à elles : elles
  passent par trois totaux groupés, `BH` (travaux, fournitures et services extérieurs, lignes
  17 à 22), `BJ` (transport et déplacements, 23-24) et `BM` (frais divers de gestion, 26-30).
  Une lecture rapide du PDF fait lire « BH = petit outillage » parce que la case est dessinée à
  la hauteur de la ligne 19, au sommet de l'accolade. Trois vérifications indépendantes le
  démentent : la ligne 33 est `TOTAL (lignes 8 à 32) = BR`, donc ces onze lignes ne pourraient
  jamais y entrer ; dans le PDF les cases qui entrent dans un total sont en colonne x ≈ 456-459
  et les cases « dont » (BW, BT, BZ, BU, BY) en colonne intérieure x ≤ 374 ; enfin le bas du
  2035-B dit « Total A à reporter **ligne 23** de l'annexe 2035 A », or la seule case de ce bloc
  est BJ. Conséquence produit : « Honoraires » et « Assurance » tombent toutes les deux dans BH,
  donc le rattachement poste → case n'est pas un pour un (voir `cases2035.ts`).
- **Les amortissements ne sont pas dans le cadre 3.** Ils entrent ligne 41 du 2035-**B** (`CH`)
  et redescendent par la ligne 45. Le résultat final est le même qu'en les mettant dans les
  dépenses, l'emplacement non — et c'est l'emplacement qui fait une déclaration juste.
- **Le PDF officiel de la 2035 n'a aucun champ de formulaire** — zéro `/AcroForm`, zéro
  `/Widget`, vérifié sur le fichier de la DGFiP. Le remplissage écrit donc du texte à des
  coordonnées. Elles ne sont **pas** codées en dur, sinon tout serait à reprendre à chaque
  millésime : chaque case porte son code dans la couche texte, et le **deuxième** filet vertical
  à droite du code ferme la case du montant (le premier ferme la cellule du code lui-même). La
  règle vaut aussi pour les cases « dont », plus étroites. Voir `gabarit2035.ts`, dont les tests
  lisent le vrai formulaire livré dans `public/formulaires/`.
- **`Intl.NumberFormat('fr-FR')` casse la génération de PDF.** Il sépare les milliers par une
  espace fine insécable (U+202F) que l'encodage WinAnsi des polices PDF standard ne sait pas
  représenter : pdf-lib lève une exception sur le premier montant à quatre chiffres, donc sur à
  peu près toute déclaration réelle. Formater les milliers à la main. Même famille de problème
  pour le texte libre (nom du dossier) : `texteCompatiblePdf` translittère ce qui sort de CP1252
  plutôt que de laisser échouer le formulaire, et les lettres barrées (Ł, Đ) ont besoin d'une
  table explicite puisque Unicode ne les décompose pas.
- **pdf.js vide (`detach`) le tampon qu'on lui passe.** Lire le modèle avec pdf.js puis le
  donner à pdf-lib sans `slice(0)` préalable livre un `ArrayBuffer` de longueur zéro — panne
  silencieuse et déroutante.
- **Pour regarder un PDF généré, le rendre soi-même.** Le visualiseur PDF de Chromium ignore
  `#view=Fit` et ne se laisse pas cadrer ; passer par pdf.js dans un canvas. Les hôtes inventés
  (`https://rendu.local`) sont interceptés par le proxy de l'environnement avant les routes
  Playwright : servir les fichiers depuis un vrai serveur HTTP sur `127.0.0.1`.
- **Valider automatiquement demande TROIS signaux concordants, pas deux.** Montant au centime,
  date dans la tolérance avec un appariement mutuellement unique, ET fournisseur de la pièce
  retrouvé dans le libellé bancaire (voir `appariementBanque.ts`). Les deux premiers ne suffisent
  pas : sur le premier jeu réel, une pièce à 198 € avait le bon montant, la bonne date et un seul
  candidat en face — avec un tiers lu « DARNIS JEREMY », le nom du client lui-même, là où la banque
  disait « PRLV SEPA TRANSMEDICAL ». Un faux négatif coûte un clic ; un faux positif inscrit une
  donnée fausse comme vérifiée par le cabinet.
- **Un rapprochement qui hésite dit un symptôme, pas une cause.** `analyserAppariements` a été exécuté
  sur les données réelles du dossier `test` (41 pièces, les 26 mouvements non rapprochés qui pouvaient
  former une paire) : 6 appariements certains, 6 à arbitrer, et **chacun des six refus est juste** —
  les trois OpenAI → MACSF sont exactement le faux positif que la tolérance de change annonce, et
  « DARNIS JEREMY » → TRANSMEDICAL le cas d'origine. Le moteur ne sous-performe pas.
  Mais les deux derniers doutes, « plusieurs pièces possibles », ne venaient pas d'une ambiguïté :
  `mai.pdf` et `juin.pdf` (Transmedical, 38,40 €) portent tous deux la date du **01/06/2025**. Juin
  compte deux échéances, mai zéro. Trois conséquences en cascade, qu'aucun écran ne reliait : une
  échéance de plus part dans le mois de juin (sur un exercice à cheval, la mauvaise année) ; le
  prélèvement réel du 05/05 ne trouve plus de pièce et reste non rapproché ; et les deux pièces de
  juin se disputent celui du 05/06, donc un appariement certain devient un arbitrage. **Le
  rapprochement ne pouvait pas dire mieux** — il ne voit que la collision, jamais ce qui la produit.
  **ET CE QUI LA PRODUIT N'ÉTAIT PAS UNE DATE MAL LUE.** Première hypothèse, écrite puis démentie par
  la mesure suivante : les deux fichiers ont **exactement le même texte OCR** (même empreinte md5,
  1 400 caractères tous les deux), et ce texte dit « 1 juin 2025 ». L'extraction avait donc raison
  sur les deux. C'est le MÊME document déposé deux fois, sous deux noms — et la facture de mai, elle,
  n'a jamais été déposée. Le contrôle ci-dessous reste juste (un mois doublé à côté d'un mois vide est
  une anomalie), mais il ne sait pas dire laquelle des deux causes : c'est `doublonsDeTexte` qui la
  nomme. **La leçon vaut plus que le cas** : une hypothèse plausible, cohérente avec tous les indices
  de premier tour, et fausse — seule la mesure d'après l'a montré.
  `moisEnDoubleSurAbonnement` (lib/controles.ts) la signale : pour un (fournisseur, montant) qui
  revient sur au moins trois mois, un mois à deux échéances **avec un mois voisin VIDE** est une
  anomalie démontrée — ou bien une date a été mal lue, ou bien une pièce est en double et une autre
  manque. Le contrôle dit le mois vide ; il ne prétend pas savoir laquelle des deux. Trois décisions le rendent lisible plutôt que bavard : le mois vide est
  **exigé** (un fournisseur peut facturer deux fois dans le mois — c'est le trou qui rend la lecture
  certaine, et sur les 41 pièces réelles : une trouvaille, zéro fausse alerte) ; le voisin doit tomber
  DANS la plage observée, sinon le premier mois d'un abonnement signalerait toujours le mois d'avant ;
  et à voisins également vides c'est le **précédent** qui est proposé, une date mal lue étant presque
  toujours postérieure à la vraie (échéance, fin de période, date de règlement). Il ne corrige jamais
  rien : choisir laquelle des deux pièces déplacer demande d'ouvrir les documents.
  **Il est branché sur les pièces à valider AUTANT que sur les validées**, et c'est le piège de câblage
  de ce contrôle : dans `ChecklistTab`, `pieces` ne porte que les validées, or les deux pièces qui ont
  fait naître ce contrôle sont toutes deux « à valider » — le brancher là aurait produit un contrôle
  muet sur le cas même qu'il est fait pour voir.
  **ET LE PIÈGE S'EST REFERMÉ UNE SECONDE FOIS, SUR UN AUTRE CONTRÔLE** (20/09/2026).
  `piecesADateImpossible` ne tournait que sur les validées, alors que ses TROIS voisins immédiats
  dans le même fichier (`moisEnDouble`, `tvaImpossible`, `deviseNonConvertie`) tournent sur les deux
  piles, chacun avec un commentaire qui l'explique. Il n'avait, lui, aucune justification de sa
  restriction : un oubli, pas un arbitrage.
  **Mesuré en base** : la seule pièce de tout le schéma à porter une date impossible — 27/09/2028,
  déposée le 16/09/2026, sans tiers ni montant, confiance basse — est « à valider ». Le contrôle
  était donc AVEUGLE À 100 % en production, sur le cas que son propre commentaire cite comme
  origine. La première occurrence avait été « rattrapée par hasard, en relisant le chargement » ;
  celle-ci ne l'a pas été, et c'est ce qui décide : un piège connu mais gardé par la vigilance
  revient.
  **La règle qui départage, et qu'il faut appliquer au prochain contrôle de cet écran** : un
  contrôle qui signale une donnée ABSENTE ne vise que les validées — l'absence est normale dans la
  corbeille d'arrivée, et les signaler noierait le signal (30 pièces à valider sans catégorie face à
  10 validées). Un contrôle qui signale une donnée DÉMONTRÉE FAUSSE vise les DEUX piles : une donnée
  fausse n'est jamais normale, et elle se corrige d'autant mieux qu'on la voit avant la validation —
  après, plus personne ne regarde la pièce. Les six autres contrôles de `ChecklistTab` ont été
  confrontés à ce critère : tous corrects, `piecesADateImpossible` était le seul déplacé.
  **Un test d'écran le garde désormais** (`ChecklistTab.test.tsx`), parce qu'aucun test de `src/lib`
  ne le peut : la fonction est juste, c'est le câblage qui ment. Deux mutations mordent, dans les
  deux sens — rebrancher sur les seules validées (le défaut d'origine) et sur les seules à valider.
  **ET LE MÊME BALAYAGE A MONTRÉ QUE DEUX DE CES CONTRÔLES NE MARQUAIENT RIEN.** Cinq contrôles de
  la famille « donnée démontrée fausse » renvoient l'opérateur vers Justificatifs depuis la
  Checklist (`cible: 'pieces'`) ; trois seulement posaient un badge sur la LIGNE. « Date impossible »
  et « Devise non convertie » annonçaient donc « 1 pièce, corrigez-la » puis menaient vers une liste
  où rien ne la désigne — le défaut déjà nommé pour `doublon-texte` : un point qui compte sans
  pouvoir montrer se paie en crédit, et l'opérateur cesse de croire le suivant. Les deux badges
  existent maintenant, calculés sur le dossier entier comme leurs voisins.
  **Le badge ne suffisait PAS pour la date, et c'est une mutation ratée qui l'a montré.** Une pièce
  datée après son dépôt est par définition dans un exercice futur, donc écartée par le sélecteur
  d'exercice de l'en-tête — qui s'ouvre toujours sur une année PRÉCISE (`calculerAnneeParDefaut` ne
  rend « toutes » que sur un dossier vide). La ligne n'est pas seulement non marquée : elle est
  ABSENTE. `PointATraiter` a donc reçu un champ `detail`, rendu sous le libellé (le style
  `check-ligne-detail` existait déjà pour la liste voisine), et ce point-là dit d'ouvrir
  « toutes les années ». À retenir pour le prochain contrôle : **un point de Checklist doit vérifier
  que sa cible peut MONTRER ce qu'il compte**, pas seulement qu'elle est le bon onglet.
- **Comparer deux noms se fait mot à mot, jamais par sous-chaîne.** `libelle.includes(mot)` sur le
  libellé entier confirmait « Medical Service » avec « Transmedical » : la suite de lettres est
  bien là, à l'intérieur d'un autre mot. Au centime et au jour près, ça validait le prélèvement d'un
  tout autre fournisseur. La troncature reste tolérée (les relevés coupent : « SWISSLIFE PREVOYAN »)
  mais seulement en début de mot — l'un des deux doit commencer par l'autre.
- **La colonne « libellé » se détecte sur la densité de texte, pas sur la longueur moyenne.**
  Une moyenne calculée sur les seules valeurs non vides fait gagner une colonne presque toujours
  vide dès que ses rares valeurs sont longues. Constaté sur un relevé réel : la banque sépare le
  libellé des débits et celui des crédits en deux colonnes mutuellement exclusives, et la colonne
  « crédit » (135 lignes remplies sur 385) a battu la colonne « débit » (247 lignes). Les deux
  tiers du relevé sont entrés sans libellé — invisibles pour la recherche, pour les règles
  « toujours ignorer » et pour la détection de récurrence, toutes fondées sur ce texte.
- **Quand la colonne retenue est vide sur une ligne, le libellé se reconstitue depuis les autres.**
  `libelleDeLigne` (lib/csv.ts) joint les colonnes restantes, hors date et montant — les répéter
  polluerait toute recherche sur un montant. Le générique « Mouvement bancaire » ne sert plus que
  si la ligne entière est vide en dehors de la date et du montant. `libelle_brut` conserve la
  ligne du fichier ; `libelleExploitable` (lib/appariementBanque.ts) y retombe pour les lignes
  importées avant cette correction.

- **Une balance se reconnaît à une STRUCTURE, pas à une mise en page.** `lireBalance`
  (lib/balanceImport.ts) est la première brique de la reprise d'un dossier venu d'un autre logiciel,
  et elle ne parie sur aucune convention d'éditeur : la colonne des comptes est celle dont les
  valeurs sont des **numéros du PCG** (classe 1 à 8, au moins trois chiffres), ce qui est un
  invariant du plan comptable et non un usage. Même démarche que `lignesDeSolde`, qui reconnaît une
  ligne de solde à sa largeur plutôt qu'à son libellé.
  Quatre décisions, et chacune répare une façon de se tromper en silence :
  - **La colonne des comptes est celle qui en porte le PLUS**, pas la première qui en porte un : une
    colonne « numéro de pièce » peut en imiter un par hasard, jamais sur toutes les lignes.
  - **Un en-tête reconnu l'emporte sur la position.** Deux colonnes de nombres positifs de même
    nature ne se distinguent par AUCUN autre signal ; certains exports présentent crédit avant
    débit, et seul le mot le dit. La position (débit puis crédit, convention française) sert de
    repli, et l'en-tête n'est cherché que dans les **cinq premières lignes** — un pied de section qui
    réécrit « Crédit »/« Débit » plus bas inverserait sinon toute la balance.
  - **La ligne « TOTAUX » est écartée** parce qu'elle n'a pas de numéro de compte : l'inclure
    doublerait la balance et ferait passer un fichier parfait pour un fichier en écart.
  - **« Ce fichier n'est pas une balance » n'est pas « balance vide »** : un relevé bancaire déposé
    par erreur rend `colonnes: null` et la raison de chaque ligne écartée, jamais une liste vide.
  **Et le contrôle qui rend tout le reste utilisable** : `controlerBalance` vérifie que la somme des
  débits égale celle des crédits. C'est la définition même d'une balance, tout ayant été passé en
  partie double — un écart ne se discute donc pas, il dit que le fichier est amputé, et le cabinet
  doit l'apprendre AVANT d'y adosser une comptabilité. Mot pour mot le contrôle du relevé bancaire,
  sur un autre document. Les totaux sont arrondis au centime **avant** comparaison : sur plusieurs
  centaines de lignes, la dérive des flottants afficherait un écart qui n'est qu'un artefact de
  représentation. La tolérance d'un centime absorbe les arrondis de présentation et rien d'autre —
  deux lignes manquantes ne font pas un centime.
- **Un relevé ne contient pas que des opérations.** Il porte aussi le solde d'ouverture et le solde
  de clôture. Importées comme des mouvements, ces deux lignes faussent tous les totaux bancaires
  (28 294,39 € de mouvements inexistants sur le premier relevé réel) et ne peuvent jamais être
  rapprochées. Sur ce relevé elles n'écrivent nulle part le mot « solde » : elles portent le numéro
  de compte en guise de libellé, et le seul signal est qu'elles ont MOINS de colonnes que les
  opérations. `lignesDeSolde` (lib/soldeReleve.ts) combine les deux indices — libellé et largeur —
  en comparant à la largeur la plus FRÉQUENTE, pas à la plus grande.
- **Un contrôle affiché une fois puis jeté ne contrôle rien.** Le résultat du contrôle de solde
  vivait dans un `window.alert()` à l'import : l'opérateur cliquait « OK » et l'information était
  détruite. Un relevé incomplet redevenait invisible dans la seconde, alors que c'est précisément ce
  qu'un cabinet doit savoir avant de bâtir une comptabilité dessus. Il est désormais conservé
  (`controles_releves_bancaires`, voir `lib/controlesReleves.ts`), affiché en permanence dans Banque
  et remonté en tête de Checklist en sévérité « erreur » — avant les autres points, parce qu'un
  relevé amputé fausse tout ce qui en découle. L'écart de 5 359,00 € du dossier de test, recalculé
  depuis la base, est enregistré : il redevient visible au lieu de vivre dans un commentaire.
- **Le chemin PDF n'avait AUCUN contrôle d'arithmétique**, ses lignes de solde étant jetées au
  parsing. `soldesDuPdf` les rend maintenant à part. Mais il ne reconnaît que les lignes qui écrivent
  le mot « solde » — et **c'est une limite assumée, pas un oubli** : sur le relevé réel, ces lignes
  portent le numéro de compte, et le signal structurel qui sauve le CSV (moins de colonnes que les
  opérations) ne survit pas au recollage de pdf.js. Une heuristique textuelle a été essayée puis
  **écartée sur preuve** : « aucun mot d'au moins trois lettres » attrapait, sur les données réelles,
  32 vrais encaissements CPAM (références nues, jusqu'à 14 812 €) pour 2 lignes de solde. Elle aurait
  supprimé les recettes du dossier. Mieux vaut un contrôle qui ne tourne pas qu'un import qui perd
  des recettes — et un test fige ce choix pour qu'il ne soit pas « amélioré » à l'aveugle.
  **La réponse est donc humaine, et assumée comme telle** : l'aperçu d'import PDF montre TOUTES les
  lignes, soldes compris, avec une case « Solde » — pré-cochée quand la banque écrit le mot, à cocher
  à la main sinon. Les lignes cochées ne s'importent pas et alimentent le contrôle. Le drapeau vit
  **sur la ligne** (`LigneExtraite.estSolde`) et non dans un jeu d'indices à côté : retirer une ligne
  de l'aperçu décalerait sinon les suivantes, et le contrôle porterait en silence sur les mauvais
  montants. L'écran dit combien de soldes sont désignés et qu'il en faut exactement deux.
- **Un index unique PARTIEL ne peut pas être visé par un upsert.** `ON CONFLICT (a, b)` exige de
  répéter la clause WHERE de l'index partiel, ce que le client Supabase ne sait pas produire :
  l'écriture échoue. `controles_releves_bancaires` est née avec un index partiel (pour laisser
  s'empiler les relevés sans nom de fichier) et son upsert aurait raté à chaque import, en silence —
  la même panne que la règle tiers → catégorie restée muette des mois durant. Une contrainte unique
  **totale** donne la même sémantique sans le piège : deux NULL ne sont jamais égaux en SQL, donc les
  relevés anonymes s'empilent de toute façon. Vérifié par un aller-retour réel en base, pas par le
  faux client — un mock ne peut pas prouver qu'une contrainte existe.
- **Ces deux lignes servent à contrôler le relevé, pas seulement à être écartées.** Solde
  d'ouverture + somme des mouvements doit donner le solde de clôture ; sinon le fichier est
  incomplet, et le cabinet doit l'apprendre avant de bâtir une comptabilité dessus. Le contrôle
  porte sur TOUTES les opérations du fichier, pas sur celles qui restent après dédoublonnage —
  sinon un relevé qui chevauche un import précédent afficherait un écart qui n'existe pas. Sur le
  premier relevé réel, il révèle un écart de 5 359,00 € que rien dans les données n'explique.

- **Un fournisseur se reconnaît à une clé d'identité, pas à son nom exact.** L'OCR recopie du bruit
  autour du nom : sur un import réel, « Transmedical », « Transmedical / et redevient » et
  « Transmedical / et soigner redevient » faisaient trois tiers distincts pour dix-sept pièces du
  même fournisseur, donc trois arbitrages. `cleFournisseur` (lib/format.ts) retient le premier mot
  d'au moins quatre caractères qui ne soit pas une forme juridique ou un qualificatif — quatre et
  pas plus, sinon « ulys » (fournisseur réel) est perdu ; pas moins, sinon « m » et « sa » passent
  pour des noms. Elle rend null quand rien n'identifie personne (« CARTE BANCAIRE »), et l'appelant
  traite alors la pièce isolément plutôt que de la regrouper au hasard.
  **Les sigles pointés sont recollés avant que la ponctuation ne soit aplatie** : « C.P.A.M. » devient
  « cpam ». Sans ça les points passaient en espaces comme le reste, le sigle explosait en lettres
  isolées, le seuil de quatre caractères les éliminait toutes — et la fonction retenait le mot
  suivant. « C.P.A.M. Marseille » rendait donc **« marseille »** : pas une absence de clé, une clé
  FAUSSE, celle d'une ville, sous laquelle deux organismes différents de la même ville se seraient
  confondus. Un point ne compte que s'il suit une lettre SEULE et qu'une lettre le suit
  immédiatement, avec au moins deux groupes et un point final facultatif (l'OCR le perd souvent) :
  ni « www.edf.fr » ni « Cabinet X. Y. Martin » ne sont touchés. Le seuil des quatre caractères reste
  entier et le déborde : « E.D.F. » devient « edf », donc rejeté comme l'était « EDF ».
  **Le critère d'entrée dans `MOTS_SANS_IDENTITE` est toujours le même** : si ce mot était retenu
  comme clé, deux tiers sans rapport se confondraient sous lui. Une clé FAUSSE est le pire cas de
  cette fonction — bien pire qu'une absence de clé, qui ne coûte qu'un clic, là où une clé fausse
  inscrit une catégorie fausse. Trois cas trouvés le 19/09/2026 **en exécutant la vraie fonction sur
  les seize tiers réels du dossier `test`**, jamais devinés :
  « VILLA ESTELLO » rendait `villa` (la clé utile est `estello`) ; « Siège Institut national de la
  propriété industrielle » rendait `institut`, sous lequel tout autre institut se serait rangé ; et
  « RESPONSABILITÉ CIVILE PROFESSIONNELLE / PROTECTION / JURIDIQUE » rendait `responsabilite` alors
  que ce n'est pas un fournisseur du tout mais l'intitulé d'une garantie, que tout contrat RC Pro
  porte quel que soit l'assureur.
  Les deux derniers rendent désormais **`null`** : aucun de leurs mots ne désigne quelqu'un en
  particulier, donc la pièce est traitée isolément. **Le risque symétrique est gardé par un test** —
  à force d'élargir la liste on finirait par manger de vrais fournisseurs, donc « Institut Pasteur »
  doit continuer de rendre `pasteur` et « Villa Schweppes » `schweppes` : ces mots sont écartés en
  tant que MOT, pas en tant que nom. Vérifié aussi en base avant de livrer : aucune règle déjà
  apprise ne devient morte, aucune pièce déjà catégorisée n'est touchée.
- **`suggererCategorie` cherche dans cet ordre : nom exact, puis clé d'identité.** L'ordre porte une
  règle métier — un arbitrage posé sur « Apple Marseille » doit primer sur un arbitrage posé sur
  « Apple ». L'essai sur le nom exact garde aussi les règles d'avant, enregistrées sous le nom
  complet.
- **Les deux chemins d'apprentissage écrivent sous la même clé.** PieceFormModal (pièce par pièce)
  et CategoriserTiersModal (en masse) enregistrent tous deux `cleFournisseur`, sinon l'un
  n'alimenterait pas l'autre.
- **Une règle apprise ne sert à rien si elle reste enfermée dans son dossier.** `tiers_categories`
  est par dossier, `tiers_categories_cabinet` est partagée — et seules les catégories globales
  (`dossier_id` nul) ont vocation à y monter, une catégorie propre à un client n'ayant pas
  d'équivalent ailleurs. Vécu : quatre règles existaient, toutes dans `tiers_categories`, la table
  cabinet vide ; `transmedical → honoraires` avait été arbitré sur un dossier pendant que dix-sept
  pièces du même fournisseur attendaient sur un autre.

- **Une grille de saisie se repère à la régularité de son espacement, avec un écart RELATIF.**
  `grilleDeSaisie` (lib/gabarit2035.ts) trouve la plus longue suite de filets également espacés à
  droite d'un libellé — c'est ce qui distingue une grille de caractères du reste du tableau, et ce
  qui l'arrête avant les cases voisines de la même ligne (AV, AS). Un critère d'écart ABSOLU ne
  trouvait que sept cases sur quatorze : sur le formulaire livré, une cellule de la grille SIRET
  fait 20,8 pt là où ses voisines font 19,8. La fonction renonce si le compte de cellules trouvé
  n'est pas celui attendu — un numéro décalé d'une case est pire qu'un numéro absent.

- **Le barème kilométrique est saisi, jamais deviné, et jamais emprunté à une autre année.**
  `BAREMES` (lib/baremeKilometrique.ts) porte un millésime et sa source ; une année absente fait
  échouer le calcul plutôt que de retomber sur la précédente — un barème périmé appliqué en silence
  produit une déduction plausible et fausse. L'administration publie des tables SÉPARÉES pour les
  véhicules 100 % électriques ; elles valent les thermiques × 1,2 arrondies (vérifié sur les vingt
  valeurs), mais ce sont les chiffres publiés qui sont repris — c'est contre eux qu'un contrôle se
  fera. Hybrides et hydrogène relèvent de la table thermique, comme le dit la publication.
  **2026 reprend la table de 2025**, le barème n'ayant pas été revalorisé : c'est littéralement la
  même table qui est partagée, jamais une copie — deux listes recopiées finiraient par diverger sur
  un chiffre, et personne ne saurait laquelle fait foi (un test fige l'identité). Sa `source` dit
  qu'elle ne vient PAS d'une publication mais d'une absence de revalorisation confirmée par le
  cabinet : le barème des revenus 2026 paraîtra au printemps 2027 et devra alors être confronté à
  cette table. Ajouter un millésime reste un acte explicite même quand les valeurs ne changent pas —
  la liste `BAREMES` est figée par un test.
- **Ce barème n'est pas progressif par tranches cumulées.** La tranche sert à choisir une formule,
  qui s'applique ensuite au kilométrage TOTAL ; le forfait de la tranche intermédiaire n'existe que
  pour rattraper l'écart au point de bascule. Conséquence pour les tests : le barème est **continu à
  la borne basse** (5 000 × 0,529 = 5 000 × 0,316 + 1 065), donc un test posé sur cette borne ne
  distingue pas `<` de `<=` et ne prouve rien. La borne haute, elle, est discontinue (7 385 € contre
  7 400 € à 20 000 km) : c'est là qu'il faut tester. Même piège pour les deux-roues, dont les bornes
  sont 3 000 / 6 000 et non 5 000 / 20 000 — un test à 3 000 km ne les distingue pas de celles des
  voitures, un test à 4 000 km oui.
- **Les véhicules du cadre 7 sont par EXERCICE, pas par dossier.** L'option pour le forfait se prend
  au 1er janvier et vaut pour l'année entière (notice, renvoi 12), donc la table `vehicules` porte
  une ligne par véhicule ET par année. Le total se reporte ligne 23 du 2035-A (case BJ) — le bas du
  2035-B le dit explicitement.
- **Un écran de SAISIE ne choisit pas l'exercice à la place du cabinet.** Les
  onglets de consultation acceptent « toutes années » et cumulent ; un écran qui
  écrit des données datées ne le peut pas. La carte Véhicules retombait sur
  l'année civile en cours : des kilomètres partaient sur un exercice que personne
  n'avait demandé, et l'indemnité revenait en « barème non renseigné » sans que le
  lien avec l'année soit visible. Elle propose maintenant les exercices
  (`exercicesProposables` : ceux qui portent déjà des véhicules ∪ ceux dont le
  barème est saisi) et n'affiche ni tableau ni bouton d'ajout tant qu'aucun n'est
  choisi. Le choix est offert LÀ où la question se pose, pas par un renvoi vers
  l'en-tête. Et un exercice vide dit sur quelles autres années les véhicules
  existent — c'est ce qui évite de ressaisir des kilomètres déjà enregistrés.
- **Un champ grisé garde sa valeur, et cette valeur compte encore.** Une voiture
  de 6 CV basculée en « cyclomoteur » conservait sa puissance fiscale ; la ligne
  « cyclomoteur » du barème ne couvrant que la puissance 0, l'indemnité repartait
  en « puissance hors barème » — un calcul qui échoue alors que rien à l'écran ne
  paraît faux. Le champ devenu sans objet est donc remis à zéro dans la MÊME
  écriture (`completerModificationVehicule`), et la règle vit dans le barème, pas
  dans l'écran : c'est lui qui décide qu'un cyclomoteur n'a pas de puissance
  fiscale et qu'un véhicule électrique ou à hydrogène n'a pas de carburant. Elle
  est appliquée dans `modifier()`, un seul point de passage, pour qu'aucun champ
  ajouté plus tard n'y échappe par oubli.
- **Le forfait kilométrique et les frais de véhicule au réel ne cohabitent pas.** Les deux tombent
  dans la case BJ, donc la même dépense y serait comptée deux fois — et BJ n'affiche qu'un total qui
  ne dit pas de quoi il est fait. La note (12) de la notice est explicite : les dépenses couvertes
  par le barème « ne doivent alors figurer à aucun poste de charges ». `doublonFraisVehicules`
  (lib/cases2035.ts) le signale sans jamais corriger : choisir entre le forfait et le réel est un
  arbitrage qui engage l'exercice entier et tous les véhicules.
  Le contrôle vise une **liste explicite de postes** (frais de véhicules, carburant), pas « toutes
  les cases BJ » : la ligne 24, « Autres frais de déplacements » — train, hôtel, taxi — coexiste
  légitimement avec le forfait. Ni « Entretien et réparations » ni « Primes d'assurance », qui vont
  en BH et désignent aussi bien le cabinet que la voiture. Un avertissement qui se trompe souvent
  finit par ne plus être lu, et le seul poste existant en production (« Frais de déplacement ») est
  précisément un de ceux qu'il ne faut pas signaler.
- **`vehiculeDuDossier` est le seul passage fiche → barème.** Le champ `electrique` vaut 20 % de la
  déduction et se déduit de `motorisation === 'electrique'` ; recopier cette conversion dans chaque
  appelant la ferait diverger sur exactement ce point.
- **Le moteur de la 2035 exige les véhicules, sans valeur par défaut.** `calculerDeclaration2035`
  prend `vehicules` en paramètre obligatoire : un appelant qui les oublie doit le découvrir à la
  compilation, pas en lisant une case BJ vide sur un formulaire déjà déposé.

- **Un relevé n'est pas une facture, et son montant n'est pas une charge.** La
  classification retombait sur « facture » par défaut, donc en PIÈCES, pour deux
  familles qu'elle ne connaissait pas : les relevés d'ACTIVITÉ de l'Assurance
  Maladie (SNIR, relevé individuel d'activité, relevé d'honoraires) et les relevés
  de SITUATION d'un contrat d'épargne. Sept dormaient ainsi dans le dossier test
  pour **73 565 €**, sur une base de facturation réelle de 8 806 € — un facteur
  huit, prêt à partir en charges le jour où un opérateur leur donnait une
  catégorie. Un relevé de situation donne un CAPITAL, pas un versement : ce n'est
  pas davantage une preuve de cotisation déductible, celle-ci passe par un avis de
  versement.
  Les marqueurs sont testés APRÈS les cotisations : un courrier URSSAF parle lui
  aussi de « situation », et c'est un appel de cotisation qu'il faut y voir. Ils
  évitent le seul mot « assurance vie », qui figure sur de vraies factures de
  courtier. Validés en exécutant la vraie fonction sur les textes OCR réels du
  dossier : 41 factures sur 41 restent des factures.
- **Un justificatif de RECETTE est une pièce, pas un document — et pas un achat.** Un bordereau
  de télétransmission (le récapitulatif d'un lot de feuilles de soins envoyé à l'Assurance Maladie
  et aux mutuelles) est le justificatif de ce que le praticien a facturé. Classé « facture » comme
  tout le reste, il devenait une pièce d'ACHAT : son montant partait en charge, et la recette qu'il
  justifie n'était comptée nulle part — **le même euro compté deux fois à l'envers dans le
  résultat**. Trouvé en production sur un bordereau à 364,75 €, statut « à valider ».
  Le marqueur porte sur le nom du document (`BORDEREAU DE TÉLÉTRANSMISSION`), réglementaire
  SESAM-Vitale donc commun à tous les logiciels de facturation, jamais sur les libellés d'un éditeur
  (« LOT NON SECURISE », « Réalisé par … ») qui ne diraient rien du bordereau d'un confrère équipé
  autrement. Il est testé **en premier**, avant toutes les autres familles : c'est le seul marqueur
  posé sur le TITRE du document, et un mot-clé croisé au fil d'un long texte OCR ne doit pas primer
  sur le nom que le document se donne.
  Frontière à garder en tête : un **relevé d'honoraires** reste « autre » (Documents). C'est un ÉTAT
  de l'activité de l'année, pas le justificatif d'un encaissement — les deux documents parlent
  pourtant d'activité facturée, et c'est la distinction la plus fine de `classifieDocument`.
  Réserve professionnelle assumée : un bordereau dit ce qui a été FACTURÉ, l'encaissement arrive plus
  tard sur le compte. En BNC (recettes-dépenses), la recette se reconnaît à l'encaissement — la pièce
  sert donc de justificatif à rapprocher du virement de la caisse, et c'est la date de l'encaissement
  qui fait foi si elle diffère. L'écran le dit à l'arbitrage.
- **Le sens d'une pièce est décidé par la classification, jamais par l'appelant.** `orientationDe`
  (lib/extraction.ts) rend en un seul endroit la destination (Pièces / Documents) **et** le
  `type_piece`. `depot.ts` (client) et `importFichiers.ts` (cabinet) sont des jumeaux assumés et
  portaient tous deux la même règle écrite en dur : « tout ce qui n'est pas une facture part en
  Documents », plus un `type_piece: 'achat'` littéral. Cette règle était vraie tant que `facture`
  était la seule classification restant en Pièces ; le premier justificatif de recette la rendait
  fausse **des deux côtés à la fois**. Une répartition exhaustive, à un seul endroit, ne peut plus
  diverger — et une classification ajoutée sans être traitée ne compile pas.
  **Il y en avait une TROISIÈME, et elle a été oubliée le jour même.** `receive-email` (Edge
  Function, donc auto-portée : elle ne peut rien importer de `src/`) portait sa propre version du
  test binaire `classification === "facture"`. Un bordereau reçu par e-mail partait donc vers
  `documents_divers` avec `categorie: "facture_vente"`, valeur que le CHECK de la table refuse :
  insertion en échec, pièce jointe **perdue**, fichier orphelin dans le stockage, et pour seule
  trace un `console.error`. Son union de classifications mentait aussi — restée à quatre valeurs
  quand la classification en rendait six. Corrigé, et surtout **gardé par un test**
  (`receiveEmailOrientation.test.ts`) qui lit la vraie source déployée et compare sa copie à
  `orientationDe` sur chaque classification, dont qu'aucune ne produise une catégorie que le CHECK
  refuserait. Règle qui en découle : **chercher toutes les copies avant de corriger la première**,
  Edge Functions comprises — `grep` sur la valeur, pas sur le nom de la fonction.
- **Le « pourquoi » d'une dépense ne s'extrait pas, il se demande.** L'OCR lit
  « BOULANGER MARSEILLE, 199,99 € » et s'arrête là : il ne dira jamais si c'est le
  four de la salle d'attente ou un cadeau, et c'est pourtant ce qui décide de la
  catégorie. Le seul qui le sache est le client, à la seconde où il prend la
  photo. D'où `piece_commentaires` et le fil de précisions — pensé pour coûter
  cinq secondes au client plutôt qu'un appel téléphonique au cabinet, qui est la
  chose la plus chère de toute la chaîne.
  Trois règles le rendent utile plutôt que décoratif : la précision se demande
  **au dépôt** (`deposerFichier` rend la ligne créée pour qu'on puisse la
  proposer sur CE dépôt-là) ; elle est **facultative et jamais bloquante**, sinon
  le client cesse d'envoyer ses documents ; et elle se lit **sur la ligne
  d'arbitrage**, pas dans une modale — un opérateur qui doit ouvrir une fiche
  choisira la catégorie sans l'avoir lue. Le champ `pieces.notes` existait depuis
  le début et n'a jamais servi (0 pièce sur 83) précisément parce qu'il n'était
  exposé qu'au cabinet, dans une modale.
  Et la limite : un commentaire est une **information, pas une décision**. Le
  client peut se tromper ou arranger les choses ; l'arbitrage reste celui du
  cabinet, comme partout ailleurs.

- **Le texte lu par l'OCR est conservé, et montré à l'arbitrage.** Il était
  calculé à chaque extraction — c'est lui qui classe le document, retrouve une
  date, rattrape une TVA — puis jeté. Or c'est la réponse la moins chère au
  problème du « pourquoi » : zéro saisie, pour personne. « BOULANGER MARSEILLE »
  ne dit pas ce qui a été acheté ; le texte du document, lui, dit
  « FOUR MICRO-ONDES ». Il complète le commentaire du client sans le remplacer —
  l'OCR dit CE QUI a été acheté, le client dit POURQUOI.
  Trois décisions le rendent utilisable : il vit dans une table à part
  (`piece_textes_ocr`) et **jamais sur `pieces`**, parce que plusieurs écrans
  font `select('*')` dessus et qu'un texte OCR pèse des kilo-octets par ligne ;
  il se **charge à la demande**, une pièce à la fois ; et il est **rendu tel
  quel**, sans filtrage ni troncature, sinon on ne peut plus diagnostiquer une
  extraction douteuse avec.
- **Le texte OCR couvre les DOCUMENTS autant que les pièces — la première version s'arrêtait à
  mi-chemin.** Textract tourne sur tous les fichiers déposés : le texte revenait donc aussi pour les
  relevés bancaires, les appels de cotisation, les attestations et les relevés d'activité, et il
  était jeté pour chacun. Soixante-sept documents en production, dont les SNIR qui portent les
  honoraires de l'année — précisément le document qu'un cabinet veut pouvoir relire. Le même texte
  qu'on venait de payer.
  Pire : **déplacer une pièce vers Documents supprimait son texte en cascade**, la table étant
  indexée sur `piece_id`. Les trois SNIR du dossier de test ont perdu le leur de cette façon.
  La table garde son nom (`piece_textes_ocr`) pour ne pas casser le code, mais porte désormais
  `piece_id` XOR `document_id`, comme `lignes_bancaires` porte `piece_id` XOR `cotisation_id`. Et
  `convertirEnPiece` lit le texte AVANT de supprimer le document, sinon il le perdrait au moment même
  où il redevient utile.
  **Deux pièges de schéma évités, tous deux déjà connus du projet :** la clé primaire est devenue un
  `id` de substitution (`piece_id` devant pouvoir être nul), donc `enregistrerTexteOcr` vise
  explicitement sa colonne en `onConflict` — sans quoi l'upsert ne trouverait jamais de conflit et
  empilerait un doublon par relecture. Et les contraintes uniques sont **totales**, pas partielles :
  une contrainte unique sur une colonne nullable laisse passer autant de NULL qu'on veut tout en
  dédoublonnant les valeurs réelles, là où un index partiel ne peut pas être visé par `ON CONFLICT`.
  RLS vérifiée par impersonation : le client écrit sur un document de SON dossier, se fait refuser un
  document d'un autre dossier annoncé sous le sien, et le CHECK refuse zéro comme deux cibles.
- **Une relecture coûte un appel Textract facturé.** `relireDocuments`
  (lib/relectureDocuments.ts) comble la date ET le texte en UNE passe : les
  séparer paierait deux fois la même lecture. Elle ne relit que ce qui manque
  (`piecesARelire`), et n'écrit jamais rien d'autre — jamais le tiers, jamais les
  montants, jamais le statut, et la date seulement si elle était vide. C'est
  cette règle qui la rend sûre à lancer sur un dossier entier de pièces déjà
  validées et corrigées à la main.
  **Et la liste « qui a déjà un texte » DIT si elle a pu être lue** (`PresenceTexteOcr`, lib/texteOcr.ts).
  C'est ce qui décide de la dépense : une lecture refusée rendait un ensemble VIDE, indiscernable de
  « aucun texte en base », et les deux écrans proposaient alors « Retrouver le texte lu (N) » sur le
  dossier entier — soit N appels Textract facturés sur des documents dont le texte est peut-être déjà
  archivé. Le bouton disparaît donc quand la liste est illisible, en disant pourquoi : un bouton qui
  manque sans raison visible est le début d'un ticket, et ici sa présence coûte de l'argent. Famille
  déjà connue (« une lecture dont l'échec ressemble à un résultat vide »), appliquée cette fois à la
  seule liste dont dépend une facture.
- **« L'application accepte ce fichier » et « Textract sait le lire » sont DEUX questions.** La
  première est `EXTENSIONS_SUPPORTEES` (importFichiers.ts) et inclut le CSV, à juste titre : un relevé
  bancaire CSV est parfaitement légitime. La seconde est `textractPeutLire` (lib/extraction.ts) et
  l'exclut : Textract répond `UnsupportedDocumentException` (HTTP 400) sur un CSV comme sur un texte
  brut. Les deux listes se ressemblent assez pour qu'on prenne l'une pour l'autre.
  La règle EXISTAIT, écrite deux fois et en dur : `depot.ts` et `importFichiers.ts` court-circuitaient
  tous deux le `.csv` avant d'appeler l'extraction. `relectureDocuments.ts`, arrivée après, ne l'a pas
  héritée — elle ne filtrait que sur `storage_path`. **Mesuré le 20/09/2026 sur le dossier `test`** :
  des 37 documents relus, 36 ont reçu leur texte et le 37e est le relevé CSV, qui a rendu son 400 (vu
  dans `function_logs`). N'ayant jamais de texte, il restait éligible **à chaque clic** : le bouton
  annonçait « (1) » indéfiniment et l'écran « 1 échec », c'est-à-dire un incident à réessayer. Huit
  fichiers de la base sont dans ce cas (6 `.txt`, 2 `.csv`).
  C'est le motif déjà connu — **chercher toutes les copies avant de corriger la première** — pris par
  l'autre bout : ici la règle était juste aux deux endroits où elle était écrite, et c'est le
  NOUVEAU caller qui ne l'a pas reçue. Une règle recopiée deux fois n'attend pas de diverger ; elle
  attend un troisième appelant.
  Deux décisions la rendent durable : **liste blanche et jamais liste noire** (interdire `csv`/`txt`
  laisserait passer le premier `.xlsx` ou `.zip` avec exactement le même symptôme — un test le fige) ;
  et **un fichier sans extension est envoyé quand même**, parce que refuser d'essayer ferait taire
  l'extraction sur un PDF valide simplement renommé. Le coût des deux erreurs n'est pas le même : ne
  pas extraire un fichier lisible se perd en silence, un résidu dans la relecture reste sous les yeux
  de l'opérateur.
- **Un point de Checklist choisit sa destination, il ne l'écrit pas en dur.** `doublon-texte` portait
  `cible: 'pieces'`, ce qui était juste tant que seules les pièces avaient un texte OCR. Depuis que les
  documents en ont un (20/09/2026), un groupe de doublons peut n'être fait que de DOCUMENTS — et
  l'onglet Pièces n'a alors aucune ligne à montrer. Un point qui annonce « 1 » et renvoie vers un écran
  vide est pire qu'un point absent : l'opérateur cherche, ne trouve pas, et cesse de croire le suivant.
  La destination suit donc le contenu du groupe, et `DocumentsTab` porte le même badge « Doublon de
  contenu » que `PiecesTab`. **Le module n'avait pas ce défaut** : `DoublonDeTexte` portait
  `pieceIds` ET `documentIds` depuis le début — seuls les écrans s'arrêtaient à mi-chemin, faute de
  pouvoir être exercés tant qu'aucun document n'avait de texte.
- **Mesuré le 20/09/2026, résultat négatif à garder** : sur les 77 textes du dossier `test` (41 pièces
  + 36 documents), les 36 documents fraîchement lus n'introduisent **aucun** nouveau doublon de
  contenu. Le seul groupe reste `mai.pdf` / `juin.pdf`, déjà connu. La question qui motivait la mesure
  — « un même relevé est-il classé une fois en Pièces et une fois en Documents ? » — a donc une
  réponse, et c'est non. Elle ne se redemande pas à chaque session.
- **CE MOTIF SE BALAIE, ET LE BALAYAGE EST MÉCANIQUE** (20/09/2026) : toute fonction exportée de
  `src/lib` dont le nom n'apparaît dans AUCUN autre fichier de production. Trente-deux candidates,
  dont vingt-quatre sont exportées uniquement pour être testées à l'unité — motif légitime et
  courant ici. **Huit n'ont littéralement aucun usage hors de leurs tests**, et il a fallu les
  regarder une par une : « personne ne l'appelle » a plusieurs causes, et une seule est un défaut.
  **Deux étaient de vraies moitiés de fonctionnalité — LES DEUX SONT LIVRÉES** (20/09/2026), et
  c'est le balayage qui les a fait exister : aucune des deux ne se serait vue autrement, chacune
  étant complète de son côté base et de son côté logique.
  - **`balanceImport.ts` en entier** — `lireBalance`, `controlerBalance`, `classeDuCompte`. Écrit,
    testé, décrit longuement ici comme « la première brique de la reprise d'un dossier venu d'un
    autre logiciel », et **importé par rien**. `BalanceCard` (onglet Informations, à côté de la
    sauvegarde) ferme le chemin. Périmètre délibérément borné à la LECTURE et au CONTRÔLE : vérifié
    en base, aucune table ne porte de balance reprise, et en inventer une sans savoir ce qu'elle
    doit alimenter — des à-nouveaux ? une comparaison avec la balance de l'application ? — serait
    deviner un choix produit. L'usage reste complet tel quel (« cet export est-il entier ? »), et
    l'écran DIT que rien n'est enregistré plutôt que de laisser croire à une reprise.
    **Le défaut que le module ne pouvait pas voir, parce qu'il reçoit déjà du texte** : un export
    comptable français sort souvent en CP1252, et « Charges à payer » décodé en UTF-8 indulgent
    devient « Charges Ã  payer » — or les libellés SONT les noms de comptes. On décode en UTF-8
    STRICT (qui LÈVE sur une séquence invalide) avec repli windows-1252, plutôt que de renifler un
    U+FFFD après coup. Les chiffres étant de l'ASCII dans les deux cas, le contrôle d'équilibre
    reste juste même si ce repli se trompait.
  - **`supprimerCommentaire`** — la fonction existait, la policy RLS `piece_commentaires_delete`
    existait, ce fichier décrivait la capacité, et `FilCommentaires` n'avait **aucun bouton**.
    Livré, avec une garantie portée par le TYPE et non par une relecture : les props du composant
    sont une union discriminée où `estCabinet: true` EXIGE `onSuppression`, et le côté client
    l'interdit. L'écran parent détient la liste et affiche la dernière précision sur la ligne
    d'arbitrage — un bouton dont il n'apprendrait rien laisserait ce résumé désigner un commentaire
    disparu. Les deux mutations mordent à la compilation.
  **Quatre sont des faux positifs instructifs, à ne pas « nettoyer » sans lire** :
  - `soldesDuPdf` (relevePdf) — le comportement qu'il porte EST livré, mais autrement : le drapeau
    `estSolde` vit sur la LIGNE et `BanqueTab` s'en sert. C'est l'ancienne conception que le drapeau
    a remplacée. Son test, lui, ne garde pas un appelant : il fige une heuristique ÉCARTÉE SUR
    PREUVE (celle qui aurait supprimé 32 encaissements CPAM). Le supprimer perdrait cette preuve.
  - `ordreSuppression` (sauvegarde) — la suppression réelle s'appuie sur la cascade Postgres depuis
    `dossiers` (voir `suppressionDossier.ts`), donc aucun ordre n'est à calculer.
  - `piecesADater` (relectureDocuments) — remplacée par `piecesARelire`, qui comble la date ET le
    texte en une passe.
  - `trierLignes` (factures) — déclarée en avance, et son commentaire le DIT (« ex. un futur
    export »). Une fonction qui annonce qu'elle attend son appelant n'est pas la même chose qu'une
    fonction qu'on a oublié de brancher.
  **La leçon du balayage** : « zéro appelant » n'est pas un verdict, c'est une question. Sur huit,
  deux étaient des fonctionnalités à moitié livrées, quatre des restes explicables, et aucune ne se
  supprime sans avoir lu pourquoi elle est là.
- **Une colonne, un affichage, et aucun chemin d'écriture : la moitié d'une fonctionnalité ne se
  voit pas.** `piece_textes_ocr` avait reçu son `document_id`, `DocumentsTab` savait déjà déplier
  « texte lu » — et RIEN ne l'a jamais rempli pour un document déjà en base, aucun appelant
  n'existant. L'écran restait donc muet, non par défaut mais faute de matière, ce qui est
  exactement ce qu'on n'a aucune raison d'aller vérifier. Mesuré le 19/09/2026 sur le dossier
  `test` : **37 documents sur 37 sans texte**, dont les SNIR qui portent les honoraires de l'année.
  `relireTextesDocuments` + `documentsARelire` ferment le chemin, avec le bouton « Retrouver le
  texte lu » dans Documents. Elle n'écrit QUE le texte, et c'est plus fort que côté pièces : un
  document n'a ni date, ni tiers, ni montant, ni statut en base — il n'y a littéralement rien
  d'autre à écrire, et cette fonction ne doit jamais devenir l'endroit où on commencerait à en
  déduire. « Textract n'a rien lu » est dit à part d'un échec : l'appel a bien eu lieu et a bien
  été facturé, les confondre ferait relancer indéfiniment sur les mêmes fichiers muets.

- **L'empreinte du FICHIER ne voit pas le même document exporté deux fois.** Le dédoublonnage du
  projet repose entièrement sur le SHA-256 du fichier, et c'est la bonne base : elle attrape le cas
  le plus fréquent, le même fichier redéposé. Mais un document repris d'un portail fournisseur,
  réimprimé en PDF, rescanné ou simplement renommé a des octets différents et la même substance.
  **Mesuré le 19/09/2026 sur le dossier `test`** : « mai.pdf » et « juin.pdf » (Transmedical, 38,40 €)
  portent deux empreintes de fichier distinctes et **exactement le même texte OCR**. Et c'est le seul
  cas du dossier — les 40 autres textes sont uniques.
  Ce que ça coûte, en chaîne : une échéance de trop dans le mois (donc la même charge comptée deux
  fois si les deux sont validées et catégorisées, en 2035 comme en balance) ; le prélèvement du mois
  réellement manquant sans pièce en face ; et deux pièces qui se disputent le même mouvement, donc un
  appariement certain refusé en « plusieurs pièces possibles ».
  `piece_textes_ocr.texte_md5` ferme l'angle mort, et trois décisions le rendent fiable :
  - **Colonne GÉNÉRÉE**, jamais écrite par l'application. Une empreinte qu'un appelant pourrait
    oublier de mettre à jour finirait par désigner un texte qui n'existe plus ; Postgres la recalcule
    à chaque écriture, donc elle ne peut pas dériver.
  - **Espaces normalisés avant le calcul** : l'OCR ne recolle pas toujours les blancs de la même
    façon, et deux lectures du même document ne doivent pas différer pour un saut de ligne.
  - **La lecture ne rapatrie QUE les empreintes** (`chargerEmpreintesTexte`), jamais les textes —
    c'est tout l'intérêt d'avoir l'empreinte en base plutôt que calculée côté client, la liste
    couvrant le dossier entier et un texte OCR pesant des kilo-octets.
  Comparé **à l'intérieur d'un dossier seulement** : deux cabinets peuvent parfaitement recevoir la
  même facture du même opérateur, ce ne serait pas un doublon. Badge « Doublon de contenu » sur la
  ligne de Pièces et point « erreur » en Checklist ; rien n'est jamais supprimé automatiquement —
  choisir laquelle des deux pièces retirer est un arbitrage.
- **`ON DELETE SET NULL` ne relâche RIEN à l'insertion.** Le socle de sauvegarde affirmait qu'une
  ligne dont le parent manque est acceptée et le lien mis à NULL en silence. Faux, vérifié en base
  (schéma jetable, une relation SET NULL) : Postgres refuse par `foreign_key_violation`, exactement
  comme sur les autres. `ON DELETE` ne décrit que la suppression du parent. Le danger est ailleurs et
  il est pire — c'est NOUS qui produisons le silence : face à un refus sur une colonne nullable, la
  correction qui vient à l'esprit est d'y écrire NULL pour que ça passe, et ça passe. Neuf relations
  du graphe le permettent, et ce sont celles qui portent le rapprochement bancaire et le lien entre
  une écriture et sa pièce. D'où `LienPerdu.effacable`, qui ne dit pas « Postgres se taira » mais
  « ce lien peut être sacrifié pour que la restauration passe » — donc : ne le sacrifie pas sans le
  savoir. Et `restaurerSauvegarde` refuse plutôt que de le faire.
- **Un `dossier_id` NULLABLE transforme `WHERE dossier_id = ?` en perte silencieuse.** Deux tables
  seulement sont concernées — `categories` et `natures_immobilisation` — et elles mélangent les
  lignes d'un dossier avec des lignes PARTAGÉES par tout le cabinet (`dossier_id` nul). En SQL une
  comparaison avec NULL n'est jamais vraie : le filtre les écarte sans le dire. Mesuré en production :
  les 10 catégories et les 8 natures du cabinet sont partagées, aucune n'appartient à un dossier —
  l'export en rendait donc ZÉRO, pendant que les 28 pièces catégorisées, une immobilisation sur deux
  et les 7 règles tiers les pointaient. `pieces.categorie_id` étant en NO ACTION, la restauration
  s'arrêtait net sur `pieces`. C'est mot pour mot le défaut du filtre de période sur les pièces sans
  date, revenu sur une autre colonne — et revenu dans le fichier dont l'en-tête met en garde contre
  « pour chaque table, WHERE dossier_id = ? ». **Savoir qu'un piège existe ne suffit pas à ne pas y
  tomber ; seul un contrôle qui tourne y suffit** (`parentsHorsPlan`).
- **`id` n'est pas la clé primaire partout.** Six tables ont une autre clé et aucune des six n'a même
  de colonne `id` : `cabinet_admins`, `super_admins`, `taux_change_bce`, et surtout trois du plan
  d'export d'un dossier — `facture_numerotation` (dossier_id, annee, type), `previsionnels_bancaires`
  et `superpdp_credentials` (dossier_id). Conséquence : une lecture paginée triée sur `id` échoue
  franchement sur elles, et une lecture NON triée rend des doublons et des trous sans erreur, Postgres
  n'étant pas tenu de garder le même ordre d'une tranche à l'autre. D'où `CLES_PRIMAIRES`. Ces trois
  tables sont minuscules par nature, donc la pagination ne s'y déclenchera jamais en pratique —
  raison de plus de ne pas les traiter à part : **un mécanisme dont la justesse dépend de la petitesse
  des données tombera le jour où elles grandissent.**
- **Une table auto-référencée passe dans UN lot et échoue en DEUX.** Vérifié sur la vraie définition
  de `factures_emises` : Postgres accepte un avoir placé avant sa facture d'origine tant que les deux
  lignes partent dans la MÊME commande INSERT, et refuse dès qu'elles partent en deux commandes. Or
  toute réinsertion découpe ses écritures en lots. Sans double passe (colonne à NULL puis reposée),
  une table restaurée d'un bloc passerait et la même en deux lots échouerait — une panne qui
  n'apparaît qu'en production, seule assez grosse pour franchir le seuil.
- **Le plan Supabase `free` ne fournit AUCUNE sauvegarde automatique** — ni quotidienne, ni PITR, ce
  sont des fonctions du plan Pro (`get_organization` sur `dloewvpmposfbvdwtqfz`). La sauvegarde de
  l'application n'est donc pas une ceinture en plus des bretelles de l'hébergeur : il n'y a pas de
  bretelles, et elle ne part pas toute seule. Voir PLAN_DE_REPRISE.md, qui liste aussi ce qui n'est
  PAS sauvegardé et qu'on découvrirait sinon en pleine reprise — au premier rang les comptes
  `auth.users`, qu'il faut recréer AVEC leurs UUID d'origine, quatre colonnes du schéma les exigeant
  en NOT NULL sans contournement possible.
- **La couverture Vitest s'arrête à `src/lib`, À SEPT ONGLETS PRÈS** (voir "Tests") : les
  composants et les Edge Functions restent, pour l'essentiel, vérifiés par la relecture de
  code, les advisors Supabase et des tests manuels réels (y compris, pour Super PDP, par
  l'utilisateur lui-même puisque cet environnement ne peut pas atteindre
  `api.superpdp.tech`). Depuis le 19/09/2026 un projet Vitest « écrans » existe (jsdom +
  Testing Library) et couvre cinq composants : les verrous d'exécution de `VehiculesCard`,
  d'`ImportDossierModal`, de la conversion document → pièce (`DocumentsTab`) et — depuis le
  20/09/2026 — du bouton « Tout rapprocher automatiquement » de `BanqueTab`, le refus de
  saisir sans exercice choisi, et la séparation recherche / totaux de la Balance des comptes.
  Depuis le 20/09/2026 s'y ajoute `EnvoyerEmailModal`, dont le verrou est le seul du projet à garder
  quelque chose qui SORT de l'application. Ses trois mutations mordent (verrou remis en état React,
  verrou jamais relâché, verrou posé après le `await`) — mais une quatrième, écrite d'abord, a
  SURVÉCU : « poser le verrou après `setEnvoi(true)` » ne déplace rien, `setEnvoi` étant synchrone.
  **Une mutation qui ne mord pas accuse d'abord la mutation, pas le test** ; réécrite en déplaçant
  l'affectation derrière le vrai `await`, elle mord.
  **21/09/2026 — sixième porteur couvert** : `FactureAvoirModal.creerAvoir`, l'un des quatre verrous
  corrigés le 20/09/2026 (voir plus haut) qui n'avait encore aucun test associé — son doublon ne crée
  pas une ligne de trop mais CONSOMME deux fois un numéro de la série "A" (RPC
  `attribuer_numero_facture`), suite légale qui n'admet ni trou ni doublon. Même famille de trois cas
  qu'`EnvoyerEmailModal` : deux clics rapprochés ne consomment qu'un numéro, un troisième clic ne
  relâche pas le verrou du premier (le cas qui distingue un verrou posé avant le `try` d'un verrou
  posé dedans), et un échec du RPC relâche bien le verrou pour permettre un nouvel essai. Deux
  mutations tuées avant de committer : retirer la garde fait échouer 2 des 3 tests, et la déplacer
  dans le `try` — le bug documenté plus haut sur d'autres modales — ne fait échouer QUE le test à
  trois clics, exactement la discrimination qu'il est censé apporter.
  **21/09/2026 — septième porteur couvert, et c'est celui dont le doublon coûte le plus cher** :
  `PieceFormModal.save`. Il crée une PIÈCE de plus sur le même justificatif, donc une charge comptée
  deux fois, en 2035 comme en balance. Quatre tests, cinq mutations, toutes mordent — et la
  répartition est ce qui compte : retirer le verrou, le remettre en état React (`saving`) ou le
  tester sans le poser font tomber TROIS tests ; le poser DANS le `try` n'en fait tomber que DEUX,
  ceux à trois envois. C'est exactement la discrimination annoncée — avec deux envois seulement, la
  version fautive paraît correcte.
  **Le formulaire est le pire déclencheur, pas le double clic** : « Valider » est un `type="submit"`,
  donc deux « Entrée » rapprochés suffisent, comme pour `EnvoyerEmailModal`. Le test couvre AUSSI
  « Enregistrer brouillon », le second chemin de la même fiche : n'exercer que « Valider » aurait
  laissé à découvert le geste le plus courant sur une pièce qu'on vient de déposer.
  **Il reste UN des quatre verrous sans test d'écran** : `SuperPdpFactureModal.appeler`.
  **`EcrituresTab` a rejoint la liste le 20/09/2026**, et c'est l'onglet qui le méritait le plus :
  il produit les deux seuls fichiers officiels du projet, le FEC et la piste d'audit. Quatre tests,
  cinq mutations, toutes mordent — dont celle qui compte vraiment : rebrancher `ecrituresSansObjet`
  sur le sous-ensemble COMPTABILISABLE au lieu de toutes les pièces validées, ce qui le rendrait
  muet pour toujours puisque la pièce vient d'en sortir. C'est mot pour mot le piège de câblage de
  `moisEnDoubleSurAbonnement`, et aucun test de `src/lib` ne peut le voir : la fonction, elle, est
  juste. Les trois autres mutations visent le contenu du FEC exporté (`ecrituresFiltrees` et non
  `ecrituresAffichees` — une recherche ne doit pas amputer un fichier fiscal) et le refus des deux
  exports sur une lecture partielle.
  **Le faux client a eu besoin d'un second réglage pour produire une lecture INCOMPLÈTE.** Plafonner
  la taille des tranches ne suffit pas : `lireTout` recolle et rend `complete: true`, ce qui est
  précisément ce qu'il doit faire. Ce qui produit l'incomplétude est un serveur qui CESSE de rendre
  tout en continuant d'annoncer le vrai total (`muetApres`) — la boucle s'arrête sur une tranche
  vide et le compte annoncé fait foi.
  **Et une assertion de ce test ne pouvait pas se déclencher** : une regex contenant du balisage
  (`/à régénérer<\/span>/`) passée à `queryByText`, qui lit le TEXTE rendu et jamais le HTML. Elle
  était verte et ne gardait rien — la même famille que « un harnais qui ment est pire qu'un harnais
  absent », en plus discret, puisque rien ne la distingue d'une assertion qui passe.
  **`ClotureTab` a suivi le jour même**, et c'est l'onglet qui produit le seul document que le
  cabinet SIGNE. Deux tests, et le premier porte tout : une lecture incomplète sur les COTISATIONS,
  pièces intactes — un garde-fou qui ne regarde que les pièces laisse alors passer, et la 2035 part
  avec une cotisation de moins. Deux mutations sur trois mordent ; la troisième (retirer le refus
  côté gestionnaire) **survit à juste titre**, c'est une seconde ceinture qu'aucun clic ne peut
  atteindre puisque le bouton est déjà grisé — la dire mordante serait faux.
  Piège de montage à connaître : `ClotureTab` ne se rend pas sous jsdom sans doubler
  `lib/remplir2035`, qui importe `pdfjs-dist/...?url` et touche au navigateur DÈS L'IMPORT. Même
  famille que `pdfText.ts`, et la doublure est honnête ici : le test vérifie précisément que la
  génération est REFUSÉE.
  **`ChecklistTab` a suivi**, et c'est l'écran dont le silence est le plus dangereux : il prétend
  dire ce qui MANQUE, donc se taire est exactement ce qu'on attend de lui quand tout va bien. Son
  test garde un CÂBLAGE et pas un calcul — voir le piège refermé une seconde fois plus haut. Piège
  du test lui-même, à connaître pour le prochain : vérifier une ABSENCE demande de s'ancrer sur
  autre chose qui, lui, est présent, sinon un écran encore en chargement rend le test vert pour une
  raison fausse. L'ancre retenue est un AUTRE point de la même liste, que le jeu de données
  déclenche forcément.
  C'est un premier fil, pas une couverture, et **le chiffre qui le disait était faux** : ce fichier
  annonçait « dix onglets » sans test de rendu. Compté le 20/09/2026 sur la liste qui fait foi
  (`DossierTab`, src/components/DossierParcours.tsx) : **17 onglets routables, 7 testés** — banque,
  documents, statistiques, écritures, clôture, checklist, justificatifs — donc **10 sans aucun test
  de rendu**. SEPT CARTES et modales sont testées en plus, hors compte d'onglets, parce qu'elles
  portent un geste qui leur est propre : `VehiculesCard`, `ImportDossierModal`, `EnvoyerEmailModal`,
  `FilCommentaires`, `BalanceCard` (20/09/2026), `FactureAvoirModal` et `PieceFormModal`
  (21/09/2026) — SEPT au total. Un onglet n'est donc pas « testé » parce qu'une de ses cartes l'est —
  Informations reste dans les dix.
  **La liste des dossiers a rejoint les écrans testés le 20/09/2026** (`DossiersList.test.tsx`) :
  ni un onglet ni une carte mais une PAGE, donc le compte des 17 onglets ne bouge pas. Elle y est
  entrée par un défaut trouvé, pas par méthode — voir « une recherche filtre l'affichage » plus haut.
  **Deux doublures à connaître avant d'écrire le prochain test d'écran** : `PiecesTab` lit
  `monCabinetId` d'`AuthContext` (monter un `AuthProvider` complet ferait dépendre le test d'une
  session Supabase), et `piecesAvecTexteOcr` doit rendre sa forme EXACTE
  (`{ avecTexte: Set, erreur: string | null }`) — une doublure qui invente ses champs fait planter
  l'écran avant le premier test, et l'erreur ne dit pas d'où elle vient. Un chiffre
  qu'on recopie sans le recompter dérive à chaque ajout ; celui-ci se remesure en une commande.
  **`BanqueTab` portait le même défaut que les trois précédents** : `rapprocherTout` (le lot
  automatique, à distinguer de `validerEtRapprocherLot` juste au-dessus dans le fichier, qui
  lui portait déjà son verrou `useRef`) ne se désactivait que via `rapprochementAuto`, un ÉTAT
  React — donc inopérant contre un double clic dans le même rendu. Encore le même motif
  (« Un verrou d'exécution est un `useRef`, jamais un état React », plus haut, qui en tient la
  liste), trouvé en
  écrivant le test de l'écran plutôt qu'en relisant le code : mutation confirmée, le double clic
  envoyait deux fois le lot avant le correctif. Corrigé par le même `useRef` posé avant le `try`
  et relâché dans le `finally`, comme son voisin.
  Nuance à garder : les Edge
  Functions ne sont pas SANS filet — plusieurs tests lisent leur vraie source déployée pour
  en extraire une fonction et l'exécuter (montants, dates, classification, orientation,
  régions AWS) ; ce qu'aucun test ne fait, c'est les appeler en HTTP, avec leur
  authentification et leurs erreurs.
  **Les policies RLS sont sorties de cette liste** : `supabase/essais/rls.sql` les rejoue,
  tables du schéma `public` ET stockage (voir "Décisions techniques"). Deux limites à garder :
  il se lance à la main, par l'outil MCP — la CI n'a pas d'accès à la base — donc la garantie
  tient à une règle écrite et non à un automatisme ; et la SUPPRESSION d'un fichier n'est pas
  démontrable en SQL (voir RGPD.md §8.6), elle est gardée par une lecture du catalogue, plus
  faible et annoncée comme telle.
  **24/09/2026 — `AccesTab` rejoint la liste**, trouvé en balayant les huit onglets encore sans
  aucun test de rendu (voir la feuille de route Notion). Son formulaire « Donner un accès client »
  ne se protégeait que par l'état React `inviting` — même défaut, dixième porteur du motif
  « un verrou d'exécution est un `useRef`, jamais un état React ». Le doublon n'aurait pas créé
  une ligne de trop : `create-client-access` appelle `auth.admin.createUser` deux fois pour la
  même adresse, une course entre les deux appels que la fonction ne peut pas fermer elle-même —
  au mieux un message incompréhensible pour un accès qui vient pourtant d'être créé, au pire deux
  appels admin facturés pour rien. Trois tests, trois mutations, toutes mordent (même patron que
  `FactureAvoirModal` : verrou retiré, déplacé dans le `try`, non relâché dans le `finally`).
  Dix-sept fichiers de test d'écran désormais, sur 1054 tests répartis en 82 fichiers. Reste sept
  onglets sans aucun test de rendu : factures, immobilisations, cotisations, estimation,
  financement, suppléments, virements.

## Tests

Vitest sur la logique métier pure de `src/lib` — 1044 tests couvrant les dates, les
échéanciers d'emprunt, le plan de trésorerie, la situation intermédiaire, le tableau de
pilotage, le prévisionnel, l'estimation, les contrôles, le cœur comptable
(`ecritures.ts`), l'export FEC et l'export de la piste d'audit (`pisteAudit.ts`),
l'import de relevés (`csv.ts` pour le CSV, `relevePdf.ts` pour le PDF), la lecture
complète d'une collection malgré le plafond de PostgREST (`lectureComplete.ts`), la lecture
d'une balance venue d'un autre logiciel (`balanceImport.ts`),
la génération des packs et l'export d'un cabinet
(`packGenerator.ts`, `exportCabinet.ts`), la sauvegarde et la restauration d'un dossier
(`sauvegarde.ts`, `sauvegardeDonnees.ts`, `sauvegardeFichier.ts`) et le dépôt de fichiers côté client
(`depot.ts`) comme côté cabinet (`importFichiers.ts`), et le moteur de recherche partagé
par tous les écrans (`recherche.ts`) — les fichiers `*.test.ts` sont
posés à côté de leur module, et `tsc -b` les type-vérifie avec le reste.

**Deux projets Vitest, et la séparation porte une règle** (`vitest.config.ts`) : « logique »
(`src/**/*.test.ts`, environnement `node`, rien à charger) et « écrans » (`src/**/*.test.tsx`,
plugin React + `jsdom` + Testing Library). Un test d'écran ne remplace aucun test de `src/lib` :
il vise ce qu'aucun calcul pur ne peut voir — le verrou d'exécution, le câblage d'un contrôle sur
le mauvais sous-ensemble, un bouton affiché quand il ne devrait pas l'être, un total recalculé sur
les lignes qu'une recherche a retenues. Dans le défaut d'origine (141 lignes importées pour 78
fichiers), toute la logique appelée derrière était juste.
`src/test/ecrans.ts` pose le démontage automatique entre deux tests (`afterEach(cleanup)`), qui ne
s'installe pas tout seul tant que `globals` reste à false.

**Deux `fireEvent.click` de suite ne sont PAS un double clic.** Chacun ouvre son propre `act`, qui
rend le composant en sortant : le second clic tombe donc sur un bouton déjà re-rendu, avec l'état à
jour. Écrit ainsi, le tout premier test d'écran du dépôt restait VERT en remettant le verrou dans un
`useState`, c'est-à-dire avec le défaut de production réinstallé. Les deux clics partent donc dans le
MÊME `act` (`await act(async () => { bouton.click(); bouton.click() })`), qui est la séquence réelle.
Trouvé par mutation, pas par relecture — un harnais qui ment est pire qu'un harnais absent, et
celui-là mentait sur le seul défaut qu'il prétendait garder.

- `npm test` — la suite, dans le fuseau des utilisateurs.
- `npm run test:watch` — en continu pendant le développement.
- `npm run test:fuseaux` — la même suite sous Europe/Paris, UTC,
  America/New_York et Pacific/Auckland.

**Le fuseau est porté par les scripts npm, pas par `vitest.config.ts`, et ce n'est
pas un détail.** La suite est née de trois bugs de dates qui faussaient le plan
de trésorerie (chaque mois étiqueté un mois trop tôt), l'échéancier d'emprunt
(février sauté pour un prêt démarré un 31, puis tout décalé d'un jour après le
passage à l'heure d'été) et la période par défaut d'un pack. Tous passaient en
UTC — qui est justement le fuseau des runners GitHub. Une suite lancée au fuseau
par défaut les aurait laissés revenir sans rien dire.

Le fuseau a d'abord été épinglé dans `vitest.config.ts` via `env: { TZ: ... }` : cette
valeur écrasait celle du shell, si bien que `test:fuseaux` rejouait quatre fois la
même suite sous Europe/Paris en affichant les étiquettes des quatre fuseaux. D'où
`fuseau.test.ts`, qui vérifie à chaque exécution que le fuseau demandé est bien
celui appliqué — un harnais qui ment est pire qu'un harnais absent.

Règle qui en découle : **tout calcul de date reste sur le calendrier civil**
(`ajouterMois`, `dernierJourDuMois`, `premierJourDuMoisCourant`, `aujourdHuiSql`,
`anneeDe`, `moisDe`, `jourDe` dans `lib/format.ts`) — avec une exception explicite :
un `created_at` est un **instant**, pas une date civile, et se lit donc dans le fuseau
de qui le regarde (`anneeLocaleDe`, `dateLocaleDe`), sinon un dépôt fait le 1er janvier à
00 h 30 compterait dans l'année précédente — et son écriture de repli, dans l'exercice
précédent, jamais un `new Date(...)` converti par `toISOString()`, et
les bornes de période se comparent en chaînes `AAAA-MM-JJ`.

CI : `.github/workflows/tests.yml` rejoue tests multi-fuseaux + lint + build sur
toutes les branches et les PR ; `deploy.yml` lance `npm test` avant de publier,
donc un test rouge arrête le déploiement.

## Commandes utiles

```bash
npm install         # installation des dépendances
npm run dev          # serveur de dev local (Vite)
npm run build        # tsc -b && vite build — build de prod
npm run preview      # sert le build de prod en local
npm run lint         # oxlint
npm test             # Vitest, logique métier de src/lib
npm run test:watch   # Vitest en continu
npm run test:fuseaux # la suite sous 4 fuseaux (voir "Tests")
```

Déploiement : automatique sur push vers `main` (GitHub Actions →
GitHub Pages). Aucune commande manuelle de déploiement du front.

Edge Functions et migrations : exclusivement via les outils MCP Supabase
(`deploy_edge_function`, `apply_migration`, `execute_sql`, `query_logs`) —
pas de Supabase CLI configurée dans ce dépôt.

## Règles importantes pour les futures modifications

- Avant toute modification de schéma ou de policy RLS, inspecter l'état réel
  en base (`list_tables`, `execute_sql`) — ne jamais se fier uniquement à ce
  document ou à une session précédente.
- Toute nouvelle table métier rattachée à un dossier suit la convention RLS
  `admin_du_dossier(dossier_id)` et doit être vérifiée par impersonation
  réelle avant d'être considérée fiable.
- Toute policy RLS porte une clause `to` explicite (`to authenticated` en
  pratique) : sans elle, elle s'applique à `public`, donc à `anon`.
- Après toute migration touchant une policy, rejouer `supabase/essais/rls.sql`
  par `execute_sql` et vérifier que les INVARIANTS sont à 0 en faute **et** que
  les sept MUTATIONS mordent toujours. Ce n'est pas automatisé : la CI n'a pas
  d'accès à la base.
- Toute nouvelle Edge Function reste auto-porteuse (pas d'import `src/`).
- Tout nouvel appel à `supabase.functions.invoke()` doit gérer l'erreur via
  `extraireErreurFonction()`.
- Tout message d'erreur issu d'un `{ error }` Supabase passe par `messageErreur()` —
  jamais `err instanceof Error ? err.message : repli`, qui jette la raison rendue
  par Postgres (voir « Décisions techniques »). `erreursSupabase.test.ts` le vérifie
  sur toute source de production, sans exception.
- Tout nouvel onglet de dossier doit être ajouté à `TABS_VALIDES` dans
  `DossierDetail.tsx` et à `DossierParcours.tsx` pour être routable.
- Ne jamais rendre une action réseau externe (API tierce, IA, Super PDP)
  automatique/silencieuse : toujours déclenchée par un clic explicite.
- Ne jamais modifier en place une facture déjà validée — passer par un avoir
  puis une nouvelle facture.
- Pour toute évolution touchant la facturation électronique, vérifier les
  pièges EN16931 déjà listés ci-dessus avant de re-découvrir les mêmes
  rejets ; utiliser les logs de production comme source de vérité en cas de
  nouveau rejet, ce sandbox ne pouvant pas appeler l'API Super PDP
  directement.
- Avant d'élargir le périmètre d'une fonctionnalité en cours de cadrage
  (ex. facturation de suppléments), confirmer le périmètre exact avec
  l'utilisateur plutôt que de supposer.
- Un advisor Supabase au rouge n'est pas forcément une action : vérifier
  d'abord s'il est **verrouillé par le plan** (`get_organization` rend le
  plan) ou **volontaire** avant d'envoyer l'utilisateur cliquer dans un
  dashboard où le réglage n'existe pas. Voir "Problèmes connus".
- **Deux sessions ne poussent jamais sur la même branche.** Elles ne se voient pas et écrasent le
  travail l'une de l'autre sans qu'aucun signal ne paraisse — c'est déjà arrivé en plus discret, deux
  sessions ayant écrit deux ordinaux différents dans ce fichier le même jour. Une session qui
  travaille depuis une AUTRE machine (l'OCR local, par exemple) prend sa propre branche.
- Avant de supprimer une table jugée morte, réunir les six preuves plutôt
  qu'une seule : 0 ligne, 0 clé étrangère entrante, 0 vue dépendante, 0
  trigger, 0 fonction la mentionnant (`pg_proc.prosrc`), 0 référence dans le
  code (front **et** Edge Functions). Et surtout distinguer « vide » de
  « morte » : une table vide alors que la fonctionnalité qu'elle sert a
  réellement tourné est contournée ; une table vide parce que rien ne l'a
  encore exercée ne prouve rien.
