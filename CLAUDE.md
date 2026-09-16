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
  (`apply_migration` / `list_migrations`), il n'y a pas de dossier
  `supabase/migrations` local dans ce dépôt — toujours consulter l'état réel
  du schéma en base (`list_tables`, `execute_sql`) plutôt que de supposer.
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
public/CNAME      domaine personnalisé GitHub Pages (compta.jdarnis.fr).
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
  vaut mieux qu'une copie qui dérive en silence.
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
  dont le test programme la réponse — voir `contrepartieBanque.test.ts`. C'est la voie pour
  couvrir `extraction.ts`, `importFichiers.ts`, `packGenerator.ts` et les autres.
- **Un type de `types.ts` décrit la table, colonnes NOT NULL comprises.** `TiersCategorieCabinet`
  omettait `cabinet_id` : le compilateur validait donc un payload que Postgres rejetait. Vérifier
  la table (`information_schema.columns`, `pg_constraint`) avant d'écrire le type, pas après.
- **`npx tsc --noEmit` ne vérifie rien dans ce dépôt.** Le `tsconfig.json` racine a
  `"files": []` et ne fait que référencer `tsconfig.app.json` / `tsconfig.node.json` : lancé
  seul, `tsc --noEmit` sort silencieusement sans avoir typé une seule ligne, ce qui ressemble
  exactement à un typecheck réussi. La commande réelle est **`npx tsc -b`** (ce que fait
  `npm run build`). Un identifiant non importé est passé trois fois de suite à travers ce faux
  contrôle — c'est `oxlint` (`react(jsx-no-undef)`) qui l'a rattrapé.
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
- **La couverture de tests s'arrête à `src/lib`** (voir "Tests") : les
  composants, les policies RLS et les Edge Functions restent vérifiés par la
  relecture de code, les advisors Supabase et des tests manuels réels (y
  compris, pour Super PDP, par l'utilisateur lui-même puisque cet
  environnement ne peut pas atteindre `api.superpdp.tech`).

## Tests

Vitest sur la logique métier pure de `src/lib` — 308 tests couvrant les dates, les
échéanciers d'emprunt, le plan de trésorerie, la situation intermédiaire, le tableau de
pilotage, le prévisionnel, l'estimation, les contrôles, le cœur comptable
(`ecritures.ts`), l'export FEC, l'import de relevés (`csv.ts` pour le CSV,
`relevePdf.ts` pour le PDF), la génération des packs et l'export d'un cabinet
(`packGenerator.ts`, `exportCabinet.ts`) et le dépôt de fichiers côté client
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
