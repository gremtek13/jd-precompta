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
  déposé deux fois.
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
  sur le repli du code et qu'aucun fichier du dépôt ne connaît. La moitié gouvernée par le code est
  gardée, l'autre est une vérification humaine (voir RGPD.md §8.1).

- **Qui voit quoi, c'est un essai rejouable qui le dit** — `supabase/essais/rls.sql`, par
  impersonation réelle des trois profils sur les 40 tables du schéma. Il a trouvé, à sa première
  exécution, ce qu'aucune relecture n'avait vu : un visiteur anonyme lisait les catégories et les
  natures d'immobilisation du cabinet (voir « Décisions techniques »). Ce qu'il ne couvre PAS : les
  policies du stockage et les Edge Functions, restées vérifiées par relecture et essais manuels.
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
- Les données de dossiers sont des données comptables de clients réels
  (professions de santé notamment) : traiter toute pièce, e-mail ou export
  comme potentiellement identifiant, ne jamais les faire transiter par un
  service tiers non prévu dans cette liste.

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
- Sauvegarde et restauration d'un dossier (`lib/sauvegarde.ts` pour le socle pur,
  `lib/sauvegardeDonnees.ts` pour les lectures/écritures, `lib/sauvegardeFichier.ts`
  pour le fichier). Téléchargement depuis l'onglet Informations d'un dossier,
  restauration depuis l'écran super-admin. **À ne pas confondre avec un pack** : un
  pack contient les FICHIERS, une sauvegarde contient les LIGNES qui les relient ; il
  faut les deux pour repartir de zéro, et c'est la confusion la plus coûteuse à laisser
  s'installer. Voir PLAN_DE_REPRISE.md.
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
- **Déployer une Edge Function via l'outil MCP décode les échappements `\uXXXX`.** La source
  envoyée passe par une couche JSON : `̀` arrive dans le fichier déployé sous forme du
  caractère réel. Le fichier du dépôt et la copie déployée diffèrent donc textuellement partout où
  le code utilise un échappement — c'est **sans conséquence**, `/[̀-ͯ]/` et la même
  classe écrite en littéral sont la même expression.
  **Ne pas essayer de « corriger » en doublant les antislashs** : ils sont transmis tels quels et
  produisent `\\u0300`, soit un antislash littéral dans la classe de caractères. Essayé, déployé,
  et `sansAccents` ne retirait plus les accents — extraction dégradée pendant quatre minutes avant
  restauration.
  **Un déploiement se vérifie par l'empreinte, pas par une relecture** : `deploy_edge_function`
  rend un `ezbr_sha256`. Redéployer une source déjà déployée doit rendre exactement la même
  empreinte ; c'est la seule preuve bon marché qu'aucune dérive de transcription ne s'est glissée
  dans les 770 lignes qu'il faut retransmettre à chaque fois.
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
- **Une valeur par défaut connue s'applique, elle ne s'affiche pas en attendant un clic.**
  `SUGGESTIONS_COMPTE_PAR_CODE` (lib/ecritures.ts) portait depuis le début les bons comptes PCG et
  postes 2035, mais seulement comme pré-remplissage d'un champ à valider catégorie par catégorie.
  Résultat : 8 catégories sur 9 sans compte, et toute la comptabilité bloquée en aval. L'application
  vise un cabinet qui veut réduire sa saisie : ce qui est connu est appliqué, l'utilisateur vérifie
  et corrige. Un champ vide qui fait disparaître des pièces en silence est pire qu'un défaut
  modifiable — c'est pour ça que « Autre » a aussi reçu un compte (628000 / Divers).
- **Un verrou d'exécution est un `useRef`, jamais un état React.** `setRunning(true)` ne prend
  effet qu'au rendu suivant : `disabled={running}` laisse donc passer deux clics rapprochés, et
  les deux entrent dans le traitement. Sur l'import en masse, chacun repartait avec **son propre**
  ensemble d'empreintes (`chargerHashsExistants` est appelé une fois par exécution) : deux boucles
  parallèles aveugles l'une à l'autre. Constaté sur un import réel — **141 lignes pour 78
  fichiers**, le dédoublonnage ne rattrapant que les paires où le minutage jouait en sa faveur.
  Poser le verrou dans un ref, **avant le premier `await`**. Même famille que la réservation
  avant `await` du dépôt parallèle.
- **Une date de pièce postérieure à aujourd'hui est impossible, pas improbable.** Ce qu'on lit
  alors est une validité, une échéance ou une fin de droits. Le refus vit dans `toIsoDate`
  (extract-piece), avec un jour de marge pour l'écart UTC/Paris. Le placer là et non dans la règle
  de repli est délibéré : la date fautive venait du champ étiqueté par Textract, qui rejoint
  `parseDate` **sans** passer par la fenêtre `a > anneeReference + 1` de `datesDeLaLigne`. Deux
  chemins mènent à une date, un seul contrôle les couvre tous les deux.
- **Le dernier recours de `parseDate` a deux défauts connus, non corrigés.** Il délègue à
  `new Date()`, qui ignore les mois français (« 30 juin 2025 » rend `null` — les dates françaises
  en toutes lettres sont lues par l'autre chemin, `DATE_TEXTUELLE_REGEX` + `MOIS_PAR_NOM`), et il
  fait `new Date(texte).toISOString()`, soit minuit **local** relu en UTC : à l'est de Greenwich
  la date recule d'un jour. À reprendre avec les tests multi-fuseaux qui vont avec.
- **Une recherche filtre l'affichage, jamais un total.** Une barre de recherche réduit les
  lignes visibles ; les montants calculés à côté (TVA déductible/collectée, total appelé/versé,
  total prélevé) restent sur l'ensemble filtré par l'exercice, et un export (FEC) reste sur cet
  ensemble aussi — sinon le fichier fiscal part amputé des lignes ne correspondant pas au texte
  tapé. La Balance des comptes violait la règle : ses totaux débit/crédit portaient sur les
  lignes trouvées, donc taper « 606 » affichait le badge rouge « écart … », celui qui signale
  normalement un brouillon cassé. Une recherche ne doit jamais fabriquer une alerte.
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
- **La couverture de tests s'arrête à `src/lib`** (voir "Tests") : les
  composants, les policies RLS et les Edge Functions restent vérifiés par la
  relecture de code, les advisors Supabase et des tests manuels réels (y
  compris, pour Super PDP, par l'utilisateur lui-même puisque cet
  environnement ne peut pas atteindre `api.superpdp.tech`).

## Tests

Vitest sur la logique métier pure de `src/lib` — 775 tests couvrant les dates, les
échéanciers d'emprunt, le plan de trésorerie, la situation intermédiaire, le tableau de
pilotage, le prévisionnel, l'estimation, les contrôles, le cœur comptable
(`ecritures.ts`), l'export FEC, l'import de relevés (`csv.ts` pour le CSV,
`relevePdf.ts` pour le PDF), la génération des packs et l'export d'un cabinet
(`packGenerator.ts`, `exportCabinet.ts`), la sauvegarde et la restauration d'un dossier
(`sauvegarde.ts`, `sauvegardeDonnees.ts`, `sauvegardeFichier.ts`) et le dépôt de fichiers côté client
(`depot.ts`) comme côté cabinet (`importFichiers.ts`), et le moteur de recherche partagé
par tous les écrans (`recherche.ts`) — les fichiers `*.test.ts` sont
posés à côté de leur module, et `tsc -b` les type-vérifie avec le reste.

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
- Avant de supprimer une table jugée morte, réunir les six preuves plutôt
  qu'une seule : 0 ligne, 0 clé étrangère entrante, 0 vue dépendante, 0
  trigger, 0 fonction la mentionnant (`pg_proc.prosrc`), 0 référence dans le
  code (front **et** Edge Functions). Et surtout distinguer « vide » de
  « morte » : une table vide alors que la fonctionnalité qu'elle sert a
  réellement tourné est contournée ; une table vide parce que rien ne l'a
  encore exercée ne prouve rien.
