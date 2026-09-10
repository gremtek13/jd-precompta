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
- Lint : `oxlint` (`npm run lint`), pas d'ESLint. Pas de suite de tests
  automatisés à ce jour.
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
                  génériques, icônes).
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
  (enfant d'une autre table métier, ex. `mouvements_cca` sous
  `comptes_courants_associes`) suit plutôt le précédent `pack_pieces` :
  `admin_du_dossier((select dossier_id from parent where parent.id = enfant.parent_id))`.
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
- Assistant comptable IA par dossier, avec plafond de coût mensuel
  configurable par cabinet (alerte non bloquante + blocage réel côté
  `agent-comptable`).
- Export de pack (ZIP + Excel récapitulatif) à la demande, export global
  d'un cabinet, export de sauvegarde avant suppression d'un dossier/cabinet.

## Fonctionnalités actuellement en cours

- Test en conditions réelles du bac à sable Super PDP (émission de facture)
  avec l'utilisateur — plusieurs règles EN16931 déjà corrigées suite à des
  rejets réels du validateur (voir "Problèmes connus" ci-dessous pour les
  pièges déjà traités).
- Améliorations issues d'un audit comparatif avec un logiciel concurrent
  (MEG, utilisé par l'expert-comptable de l'utilisateur) — priorisées par
  l'utilisateur, traitées dans l'ordre :
  1. Fiche pièce (justificatif/champs en deux colonnes, pied fixe) — fait.
  2. Exercice unifié en en-tête du dossier — fait (voir AnneeContext).
  3. Rapprochement bancaire : suggestions par montant/date déjà en place
     (voir `BanqueTab`) ; reste à faire — aperçu du justificatif directement
     depuis le panneau de rapprochement, et une explication explicite quand
     aucune pièce n'est disponible pour une ligne.
  4. Statuts : `pieces.statut` ne distingue que validée/à valider — le
     paiement/rapprochement bancaire (`lignes_bancaires.statut`) n'est pas
     encore reflété sur la pièce elle-même dans les listes (ex. badge
     "Validée" qui ne dit rien du rapprochement).
  5. Tableau de pilotage : renommer "Statistiques" en "Balance des comptes"
     et ajouter une vraie synthèse (encaissements/décaissements, évolution
     mensuelle, avancement du dossier) — pas commencé.
  6. Navigation/textes : clarifier "Pièces" → "Justificatifs" et
     "Factures" → "Factures émises" dans `DossierParcours`, réduire les
     paragraphes longs — pas commencé.

## Problèmes connus importants

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
- **Aucun test automatisé** dans ce dépôt à ce jour — toute vérification
  passe par la relecture de code, les advisors Supabase et des tests manuels
  réels (y compris, pour Super PDP, par l'utilisateur lui-même puisque cet
  environnement ne peut pas atteindre `api.superpdp.tech`).

## Commandes utiles

```bash
npm install         # installation des dépendances
npm run dev          # serveur de dev local (Vite)
npm run build        # tsc -b && vite build — build de prod
npm run preview      # sert le build de prod en local
npm run lint         # oxlint
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
