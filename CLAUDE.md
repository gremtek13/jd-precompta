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
- **Coque d'ordinateur en trois volets** (25/09/2026, en deux étapes, à la demande du cabinet :
  « calquer l'interface PC sur celle de Claude ») : une barre latérale posée sur le fond
  de la coque (`--color-shell`), le travail dans un panneau clair aux coins arrondis (`.main`), et un
  panneau contextuel à droite (étape 2 : l'assistant, la fiche d'une pièce et le rapprochement d'un
  mouvement bancaire y vivent, à la place des fenêtres qui assombrissaient l'écran). La barre (`Layout.tsx` + `BarreDossiers.tsx`) porte « Nouveau dossier » (qui ouvre le
  formulaire du tableau de bord par `?nouveau=1`), la recherche de dossiers (`lib/recherche.ts`), la
  navigation globale, le dossier ouvert avec TOUS ses écrans en arborescence, les autres dossiers,
  et le compte en bas (thème, déconnexion). Réductible en colonne d'icônes, préférence retenue par
  navigateur (`localStorage`, comme le thème) ; réduite, la barre d'onglets du dossier
  (`DossierParcours`) réapparaît en haut du dossier, seul chemin vers ses écrans. **Le mobile ne
  change pas** : barre du haut, navigation en bas, et tout ce que la barre d'ordinateur ajoute y est
  masqué. La liste des dossiers (`lib/listeDossiers.ts`) ne se relit PAS à chaque navigation : au
  retour sur le tableau de bord, sur un dossier ouvert inconnu (une fois par identifiant, pour ne pas
  boucler sur une liste incomplète) et sur `signalerMajDossiers()` après une création. Une lecture
  tronquée ou refusée le DIT (« Liste des dossiers incomplète ») au lieu de passer pour la liste
  entière.
  **Le panneau de droite** (`components/PanneauDroit.tsx`, `lib/panneauDroit.ts`) est UN emplacement
  de la coque, posé après le panneau central. Un écran y affiche un contenu par
  `<PanneauDroit nom="…">`, qui s'y rend par un PORTAIL — le contenu reste dans l'arbre React de
  l'écran qui l'ouvre, donc garde son état et ses contextes. Un seul contenu à la fois : la coque
  retient le NOM de l'occupant, ouvrir un contenu remplace le précédent, et `fermer()` ne ferme que
  s'il occupe encore le volet. Vide, l'emplacement n'existe pas (`:empty`) : un contenu qui quitte
  l'écran — le dossier qu'on referme — l'emporte avec lui. Sous 1 280 px le volet se pose PAR-DESSUS
  le panneau central au lieu de l'écraser ; sur mobile il redevient la carte flottante d'avant — sauf
  pour la fiche d'une pièce et le rapprochement d'un mouvement, qui y prennent tout l'écran
  (l'emplacement porte le nom de son occupant,
  `data-occupant`, pour que le style le sache). Hors de la coque, `usePanneauDroit` LÈVE plutôt que
  d'offrir un bouton qui ne fait rien.
  **ET UNE GARDE DE SORTIE, parce que le volet laisse le reste de l'écran cliquable** — c'est tout son
  intérêt, et c'est ce que la fenêtre modale qu'il remplace interdisait. Une fiche en cours de saisie
  peut donc être chassée par une autre ligne, « suivante », « Assistant » ou la croix. Le contenu
  affiché pose sa garde (`useGardePanneau`) ; `ouvrir()` et `fermer()` la consultent avant qu'un AUTRE
  contenu prenne sa place ou qu'on le ferme, et rendent `false` quand elle refuse. Se rouvrir soi-même
  ne la consulte pas, et la garde d'un contenu parti est retirée avec lui — elle retiendrait sinon son
  successeur. **Ce qu'elle ne couvre PAS, dit plutôt que promis** : quitter l'ONGLET ou le dossier par
  la barre latérale démonte la fiche sans rien demander. `HashRouter` n'a pas de bloqueur de
  navigation (`useBlocker` exige un routeur de données) ; la perte y est au moins visible, le volet
  disparaissant avec l'écran.
  **La fiche d'une pièce** (`pages/dossier/FichePiece.tsx`, ex-`PieceFormModal`) : ouverte par un clic
  sur sa ligne, avec sa place dans la liste AFFICHÉE en titre (« Justificatif 3 sur 12 » — filtres,
  tri de priorité et recherche compris) et « précédent » / « suivant » pour la parcourir sans y
  revenir, grisés pendant un enregistrement. **« Valider » enchaîne sur la prochaine pièce À VALIDER**
  de la liste — après celle-ci, puis en reprenant du début — et ferme la fiche quand il n'en reste
  plus : c'est le gain que la maquette validée mettait en avant. Une réponse qui arrive pour une pièce
  que l'opérateur a déjà quittée ne déplace rien (`pieceOuverte`, lu sans attendre un rendu). La fiche
  est clée par pièce : la suivante repart de SES valeurs. Et une pièce supprimée par la sélection de la
  liste emporte sa fiche, qui sinon enregistrerait dans le vide — une mise à jour qui ne touche aucune
  ligne ne lève rien. Volet ouvert, la liste des pièces efface ses colonnes secondaires pour garder le
  statut lisible, par une requête de CONTENEUR posée sur la seule carte du tableau (`.liste-pieces`) :
  posé sur le panneau central, `container-type` en ferait la référence des éléments `position: fixed`
  qu'il contient — les fenêtres superposées des onglets —, le piège déjà nommé pour la barre latérale.
  **Le rapprochement d'un mouvement bancaire** (`pages/dossier/FicheMouvement.tsx`, ex-`PanneauLigne`
  de `BanqueTab`) suit la maquette validée : ouvert par un clic sur la ligne du relevé, « Mouvement 3
  sur 12 » et précédent / suivant comme la fiche, le libellé en entier en tête du corps. **La pièce
  proposée se JUSTIFIE** par les signaux que le rapprochement mesure — montant au centime, écart de
  date, fournisseur retrouvé dans le libellé — et ce que la banque ne confirme pas est DIT (fournisseur
  non retrouvé, sens contraire) au lieu d'être coché : trois coches sous une pièce que le rapprochement
  certain refuserait feraient d'une ressemblance une preuve. **Quand plusieurs pièces conviennent aussi
  bien, aucune n'est « proposée »** : toutes sont montrées, chacune avec son justificatif et son
  bouton — c'est le cas que « Tout rapprocher » refuse de trancher, et mettre la première en avant le
  trancherait par l'ordre de tri. **Après une action, le mouvement RESTE affiché** dans son nouvel état
  (« Rapproché avec… », annulation à portée de main), comme dans la maquette — c'est pourquoi l'onglet
  retient l'IDENTIFIANT du mouvement ouvert et relit la ligne dans le relevé à chaque rendu, au lieu de
  garder la copie prise au clic. Sorti de la liste (rapproché sous « Non rapprochés », le cas courant),
  « Suivant » mène au mouvement qui a pris sa place. Pas de garde de sortie : rien ne s'y saisit qui se
  perdrait. Et **le choix à la main ne s'applique plus au changement de la liste déroulante**, seulement
  au clic sur « Associer » : sur une liste qui a le focus, les flèches du clavier changent la valeur,
  donc la fenêtre d'avant rapprochait la première pièce venue.
  **Cette page ne se remonte pas d'un dossier à l'autre** : la barre latérale mène directement du
  dossier A au dossier B, et `DossierDetail` reste monté (même route, autre `:id`). Les onglets sont
  sous un `AnneeProvider key={id}` et repartent de zéro ; ce qui vit HORS de ce bloc doit être clé par
  dossier lui-même — l'assistant l'est (`key={dossierId}`), sans quoi le fil du dossier précédent
  restait sélectionné et une lecture plus lente de son historique pouvait remplacer la nouvelle — ou
  garder ce qu'il lit AVEC l'identifiant pour lequel il l'a lu, comme la page le fait de l'identité du
  dossier et de ses années (voir « la barre latérale a rouvert une course » dans « Problèmes
  connus »). Même règle côté client : changer de société ne quitte pas l'écran non plus, d'où le
  `<Outlet key>` de la coque.
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
                  Liste et ordre des onglets : src/lib/ongletsDossier.ts
                  (GROUPES_PARCOURS, type DossierTab), source UNIQUE de la barre
                  latérale et de la barre d'onglets du dossier — toute nouvelle vue
                  de dossier doit y être ajoutée pour apparaître dans les deux.
supabase/
  functions/      une Edge Function par sous-dossier, chacune auto-portante
                  (voir "Décisions techniques").
  essais/         essais SQL à REJOUER, pas à lire. restauration.sql : restaure un
                  dossier réel dans un schéma jetable portant les vraies contraintes,
                  compare par empreinte, puis se supprime. rls.sql : rejoue les policies
                  par impersonation des trois profils sur TOUTES les tables du schéma,
                  puis se mute lui-même pour prouver qu'il sait encore échouer.
                  allerretour.py : compare la copie DÉPLOYÉE d'une Edge Function au fichier
                  du dépôt, à rejouer après chaque déploiement.
  types/          les prothèses de type des Edge Functions (globales Deno, modules tiers bornés).
                  HORS de functions/, dont plusieurs scanners énumèrent les dossiers comme des
                  FONCTIONS — un dossier de plus y serait pris pour une fonction sans index.ts.
  schema/         export du schéma, une migration par fichier — voir PLAN_DE_REPRISE.md.
                  Ce n'est PAS la source de vérité : la base l'est, et les migrations
                  continuent de s'appliquer par l'outil MCP.
public/CNAME      domaine personnalisé GitHub Pages (compta.jdarnis.fr).
PLAN_DE_REPRISE.md  quoi faire le jour où quelque chose a disparu. Dans le dépôt Git et
                  pas dans Notion ni dans l'application : un plan de reprise hébergé sur
                  ce dont il faut se passer n'est pas un plan de reprise.
.github/workflows/deploy.yml   déploiement continu sur push vers main.
outils/captures/  banc de capture VERSIONNÉ : la vraie application servie par Vite avec un
                  faux Supabase à données fictives, photographiée par Playwright — mode
                  d'emploi en tête de vitrine.mjs ; images dans sorties/, ignoré par git.
                  debordements.mjs y liste, onglet par onglet, ce qui déborde du panneau
                  central (panneau de droite ouvert ou fermé) et rend un code d'erreur.
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
  un tableau de bord. Vérification visuelle : `outils/captures/` (la vraie application servie avec un
  faux Supabase à données fictives, photographiée par Playwright — PC 1440/1280, mobile 390, clair et
  sombre, barre réduite) — à rejouer après toute modification de `index.css` ou de la coque. L'ancien
  banc vivait dans un dossier temporaire de session et avait disparu : celui-ci est versionné pour ne
  pas se perdre de même. Piège payé : ne JAMAIS donner au navigateur le mandataire de l'environnement,
  il y enverrait aussi le serveur local (voir l'en-tête de `vitrine.mjs`).
- **Dans `.sidebar`, une seule balise `<nav>`** : sur mobile, `.sidebar nav` devient la barre fixée en
  bas de l'écran. Toute section ajoutée à la barre latérale (dossiers, arborescence d'un dossier) est
  une `<section>` ou un `<div>`, sinon elle viendrait se coller en bas du téléphone. Et le texte
  discret de la barre passe par `--color-text-barre` : le gris `--color-text-light` n'atteint pas
  4,5:1 sur le fond de la coque (4,3 calculé).
- **Une rangée de boutons ou de champs passe à la ligne** (`flex-wrap`), jamais ne déborde. Ouvert, le
  panneau de droite rétrécit le panneau central sous 700 pixels de contenu, et une rangée qui ne
  passe pas à la ligne déborde alors : son dernier élément disparaît sous le volet sans que rien ne
  casse ailleurs. `.field-row` passe à la ligne (seulement quand ses champs n'y tiennent plus), et
  un tableau vit dans un `.table-scroll`. `outils/captures/debordements.mjs` le vérifie sur les
  dix-sept onglets — 0 débordement à 1 280 et 1 440 px panneau ouvert, et à 1 024 et 1 440 fermé
  (mesuré le 25/09/2026, après avoir corrigé les cinq qu'il a trouvés : la barre d'actions des
  justificatifs, les rangées de champs d'Écritures, Cotisations et Estimation, et le tableau des
  candidates à l'immobilisation). Sa mutation mord : une rangée remise sans `wrap` le fait sortir en
  erreur.
- **Exercice partagé entre onglets** (`src/context/AnneeContext.tsx`, `useAnnee()`) : Pièces, Banque,
  Écritures, Statistiques et Clôture lisent le même exercice sélectionné, choisi une fois dans le
  sélecteur de l'en-tête du dossier (voir `DossierDetail.tsx`, `SelecteurExerciceEntete`) plutôt que
  chacun son propre filtre local — toute nouvelle vue dont un total dépend de l'exercice devrait
  rejoindre ce même contexte plutôt que réinventer un `useState<ValeurAnnee>` local. Le filtre "sans
  date" (propre aux pièces, sans équivalent sur un mouvement bancaire ou une écriture) reste un état
  local à `PiecesTab`, hors de ce contexte.
  **BALAYÉ LE 21/09/2026, RÉSULTAT NÉGATIF, à garder pour ne pas le refaire.** La question posée était
  celle qui coûte : un écran dont un TOTAL dépend d'une année qu'il a choisie lui-même, pendant que
  l'en-tête en annonce une autre — l'opérateur croit alors lire le même exercice partout. **Aucun des
  quatorze sites d'année locale n'est dans ce cas.** Trois formes, toutes légitimes :
  les cinq onglets qui portent leur PROPRE `AnneeTabs` à l'écran (Documents, Factures, Virements,
  Cotisations, Immobilisations) — le sélecteur est sous les yeux, le total lui est cohérent ;
  les chiffres ÉTIQUETÉS de leur année (« Avancement 2026 » dans la Balance des comptes, avec le
  paragraphe qui dit déjà « indépendant de l'exercice sélectionné » ; « Projection 2026 » d'Estimation ;
  « sur N mois écoulés cette année » des ratios bancaires) ; et l'année civile de `ChecklistTab`, qui
  doit RESTER civile — c'est la même que `ClientHome` et `ClientUpload`, et les trois écrans doivent
  dire la même chose au même moment (voir `moisEcoulesCetteAnnee()`).
  **Ce qui resterait à trancher n'est pas un chiffre faux mais une ergonomie** : sur ces cinq onglets,
  le sélecteur d'exercice de l'en-tête est affiché ET sans effet, puisque le cockpit englobe tous les
  onglets. Il n'est pas inerte pour autant — il prépare l'onglet suivant. À rouvrir comme une question
  produit, pas comme un défaut.
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
  `categories_et_natures_reservees_aux_connectes`).
  **MAIS « toute policy porte désormais son `to authenticated` explicite » ÉTAIT FAUX** — mesuré le
  22/09/2026 : **70 des 73 policies du schéma portent `roles = {public}`**. La règle a été énoncée,
  elle n'a été APPLIQUÉE qu'aux deux policies qui fuyaient. **Ce n'est pas une faille**, et c'est
  pourquoi elle a pu rester fausse si longtemps : ce qui ferme l'accès est le PRÉDICAT, et
  `admin_du_dossier(...)` rend `false` sans session. Les deux policies de `categories` et
  `natures_immobilisation` étaient dangereuses parce que leur `using` commençait par
  `dossier_id is null or` — vrai sans session. `rls.sql` le dit d'ailleurs noir sur blanc pour le
  stockage (« toutes portent `roles = public`. Ici les prédicats sauvent la mise ») ; c'est cette
  phrase-ci qui promettait plus que le schéma ne tient.
  **La règle qui vaut donc, et qui est la vraie** : un prédicat de policy ne doit JAMAIS pouvoir être
  vrai sans session — c'est ce que `rls.sql` éprouve réellement, par impersonation, sur toute table du
  schéma. `to authenticated` reste la ceinture recommandée pour toute NOUVELLE policy, et les
  nouvelles la portent ; réécrire les 70 existantes ne changerait rien à ce qui est accessible.
- **ET CE QUI CONTOURNE LA RLS N'ÉTAIT REJOUÉ QU'À MOITIÉ** (21/09/2026). `rls.sql` éprouvait
  `prochain_numero_facture` — la fonction `SECURITY DEFINER` qui consomme un numéro — pour le seul
  profil ANONYME. Or **aucun écran n'appelle celle-là** : `FactureAvoirModal` appelle
  `attribuer_numero_facture`, un wrapper `SECURITY DEFINER` qui délègue à la première et formate le
  résultat. Le contrôle d'accès vit dans l'APPELÉE, son commentaire le dit — et rien n'avait jamais
  exercé la CHAÎNE. Un enchaînement `SECURITY DEFINER` → `SECURITY DEFINER` est exactement l'endroit
  où l'on suppose qu'une garantie traverse.
  **Elle traverse** (`auth.uid()` lit un réglage de SESSION, pas de fonction), et c'est maintenant
  MESURÉ : anonyme refusé en 42501 (pas d'`EXECUTE`), client refusé par « Accès refusé à ce
  dossier. » sur le dossier d'un autre **comme sur le sien** — un client ne facture pas —, compteur
  inchangé, et le chef obtient bien `F2026-0001`. Sans ce dernier contrôle positif, trois refus
  seraient satisfaits par une fonction qui refuse TOUT LE MONDE.
  **ET LE PIÈGE DU 42703 SE REJOUE SUR UN APPEL DE FONCTION, en pire** : un refus levé par du
  plpgsql arrive en **P0001**, le code exact de l'annulation volontaire de ce harnais. « Pas
  accepté » ne prouve donc rien — mesuré, un essai qui n'atteint même pas la fonction (42883, nom
  inexistant) passait au VERT. Le contrôle exige désormais la RAISON : 42501, ou le message de refus
  de la fonction. M5quater le prouve en faisant échouer l'essai pour un motif sans rapport.
  **Mon premier harnais, lui, mentait dans l'autre sens** — il rangeait le verdict « accordé » DANS
  la branche P0001 du gestionnaire, donc un vrai refus ressortait en faille. `rls.sql` évitait ce
  piège depuis toujours en posant son drapeau AVANT le `raise` ; la leçon est à lui, pas à moi.
  **Le reste du fichier n'a pas été relancé** : il n'avait pas changé et aucune migration n'est
  intervenue. L'en-tête le dit plutôt que de laisser croire à un passage complet.
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
  ternaire fautif dans toute source de `src/`, **sans aucune exception** — il n'y existe pas de cas
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
  **ET « TOUTE SOURCE DE PRODUCTION » ÉTAIT FAUX : CE SCANNER S'ARRÊTAIT À `src/`** (22/09/2026,
  troisième contrôle de la journée à promettre un périmètre qu'il n'avait pas). Le ternaire interdit
  vit **huit fois** dans les Edge Functions.
  **MAIS L'Y PORTER TEL QUEL SERAIT FAUX, et c'est la mesure qui le dit** plutôt qu'une intuition. Ce
  qui rend ce ternaire dangereux n'est pas sa forme, c'est qu'une valeur NUE puisse l'atteindre — et
  une valeur nue n'arrive dans un `catch` que si quelqu'un l'a LEVÉE. Compté : `src/` porte 52
  `throw new …` contre **41 `throw <erreur Supabase>` NUS** (`throw error`, `throw insertError`,
  `throw uploadError`…), ce qui est précisément pourquoi le ternaire y était faux quarante-cinq fois ;
  les Edge Functions portent **12 levées, TOUTES `new Error`, zéro nue**, et aucun `Promise.reject`.
  Les huit ternaires y sont donc inoffensifs — par cette propriété-là, et par aucune autre.
  **LE CONTRÔLE PORTE SUR LA PRÉCONDITION, PAS SUR LE SYMPTÔME** : côté Edge Functions, rien ne doit
  être levé qui ne soit un `new …`. C'était VRAI sans être GARDÉ, donc indiscernable d'un dépôt où le
  premier `if (error) throw error` écrit demain transformerait « new row violates row-level security
  policy » en **« [object Object] »**, sur le côté où rien ne recharge et où le diagnostic passe par
  les logs de production. Le remède y est le même qu'ailleurs : `throw new Error(error.message)`.
  **POURQUOI LES HUIT NE SONT PAS RÉÉCRITS, écrit plutôt que laissé deviner** : le code déployé est
  CORRECT aujourd'hui, et le corriger demanderait sept redéploiements, chacun avec son `verify_jwt` à
  relire, sa comparaison avant écrasement et son aller-retour. Ce dépôt a déjà payé un `verify_jwt`
  retourné en silence. On ne court pas ce risque pour un défaut qui ne peut pas survenir ; on interdit
  ce qui le ferait survenir. Six mutations mordent, dont la levée nue plantée dans une vraie fonction
  et le scanner pointé sur le mauvais dossier — avec zéro faute réelle, cette borne-là est la SEULE
  chose qui distingue « propre » d'« aveugle ».
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
  **ÉPROUVÉ SUR UN DÉPÔT RÉEL LE JOUR MÊME**, et c'est la seule vérification qui restait : un PDF de
  cotisation, `1 495 tokens entrée, 70 tokens sortie, 2 champ(s) cité(s), 0 rejeté(s)`. La chaîne
  entière a tenu — OCR asynchrone, 3 061 caractères archivés, citation rendue, classification
  `cotisation`, document rangé dans Documents et son texte rattaché à `document_id`. **Le coût
  mesuré sur ce document réel est de 0,0019 $ contre 0,0055 $ qu'aurait coûté Sonnet, soit 2,97×** :
  le rapport de 3,0× annoncé par la mesure hors ligne se retrouve au centième sur la production.
  **Et c'est CET appel qui tranche la question IAM par ressource** (voir `edgeFunctionsIam.test.ts`)
  : jusque-là, seul le harnais avait invoqué Haiku. Désormais c'est `extract-piece` elle-même, avec
  ses propres identifiants, dans sa propre région.
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
- **QUATRE CITATIONS SUR CINQ SONT PAYÉES PUIS JETÉES — ET C'EST QUAND MÊME NON** (mesuré le
  21/09/2026). Un dépôt réel de cotisation a fait poser la question : l'étage 2 tourne sur TOUT
  document lu, mais le chemin Documents n'écrit que `categorie` et le texte. `DocumentDivers` n'a ni
  tiers, ni date, ni montant — vérifié dans `types.ts` et dans les deux jumeaux `depot.ts` /
  `importFichiers.ts`. Pour un relevé, une cotisation, une attestation, la citation est donc
  intégralement perdue.
  **Et la proportion n'est pas celle du nombre de dépôts, c'est celle du TEXTE** — le coût de
  l'étage 2 suit le texte, pas les pages. Sur le dossier vivant : 43 pièces pour 38 documents, soit
  47 % des dépôts, mais **80,9 % de l'entrée du modèle**, les documents faisant 20 757 caractères en
  moyenne contre 3 284 pour une pièce. Les relevés bancaires sont à la fois les plus nombreux (19 sur
  38) et les plus longs.
  **LE CHIFFRE ABSOLU RENVERSE LA CONCLUSION, ET C'EST TOUT L'INTÉRÊT DE L'AVOIR CALCULÉ** : ces
  80,9 % valent **0,28 à 0,42 $** pour l'HISTOIRE ENTIÈRE du dossier. Le gaspillage coûte **≈ 11 $
  les 1 000 documents archivés** — il faut donc ~880 documents par an pour jeter 10 $, ~4 400 pour en
  jeter 50. C'est exactement le raisonnement qui a écarté la marche 2, et il penche du même côté :
  un rapport frappant ne fait pas une facture. Changer le contrat d'une fonction dont dépend le
  chemin de production ne se paie pas avec quarante centimes.
  **CE QUI LE ROUVRIRAIT** : un cabinet à quelques milliers de documents archivés par an. C'est la
  même borne que la marche 2, et elle se relit dans `query_logs` par les lignes
  `[extract-piece] citation …`, qui portent le compte de tokens de chaque appel.
  **ET LE PIÈGE D'IMPLÉMENTATION EST ÉCRIT MAINTENANT, PENDANT QU'IL EST FRAIS** — la version
  évidente est FAUSSE. `classifieDocument` étant une fonction pure du texte, on est tenté de classer
  AVANT de citer et de sauter l'étage 2 quand la classification ne mène pas à Pièces. Mais
  `extract-piece` ne peut pas en décider seul : `PieceFormModal` l'appelle pour PRÉREMPLIR un
  formulaire que l'utilisateur est en train de remplir comme une pièce, et un saut fondé sur la
  classification lui retirerait son préremplissage en silence dès qu'un document porte un marqueur
  de cotisation. **C'est l'APPELANT qui sait ce dont il a besoin**, pas la classification : le jour
  où ce chantier se rouvre, il passe par un paramètre du contrat, pas par une heuristique interne.
  Trouvé en regardant les trois appelants, pas en relisant le gestionnaire.
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
- **Aucune donnée de patient n'a vocation à entrer, donc pas d'hébergement HDS** (tranché le
  24/09/2026, RGPD.md §8.7). Un praticien n'a pas le droit de transmettre ses bordereaux de
  télétransmission à son expert-comptable — secret médical — et n'en a pas besoin : le relevé SNIR
  justifie les recettes sans identifier personne. **La condition est tenue par la consigne donnée
  aux clients, pas par le code** : l'application accepte toujours un bordereau déposé par erreur et
  le range en Pièces comme recette. Décision du cabinet : ne rien changer au code. Ne pas le
  « corriger » sans le lui redemander, et ne pas réenquêter l'HDS au prochain audit — ce qui
  rouvrirait la question est un bordereau constaté dans un dossier réel.
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
  impersonation réelle des trois profils sur les 41 tables du schéma **et sur les trois seaux de
  stockage**, qui sont le vrai enjeu : les données de patients sont dans les FICHIERS, pas dans les
  tables (RGPD.md §4). Il a trouvé, à sa première exécution, ce qu'aucune relecture n'avait vu : un
  visiteur anonyme lisait les catégories et les natures d'immobilisation du cabinet (voir
  « Décisions techniques »). Ce qu'il ne couvre PAS : les Edge Functions en HTTP, et la suppression
  d'un fichier (RGPD.md §8.6).
- **REJOUÉ LE 22/09/2026 après la migration qui ouvre `exercices_clotures` au client** : les
  invariants 1, 2 et 3 (anonyme, authentifié rattaché à rien, client) sur les **41** tables —
  0 en faute, y compris sur la table nouvelle, que la boucle `pg_class` a attrapée sans que personne
  ait eu à l'y inscrire. **La mutation mord** : le changement de rôle retiré, 28 des 41 virent au
  rouge (les 13 restantes sont des tables vides, où « refusé » et « rien à voir » se ressemblent par
  construction). **Ce qui n'a PAS été relancé**, et c'est dit plutôt que laissé croire : les
  sections 4 à 6 (écritures d'essai, fonctions `SECURITY DEFINER`, stockage) et les sept mutations
  du fichier. Cet environnement ne peut pas exécuter `rls.sql` autrement qu'en le retranscrivant à
  la main dans un appel d'outil, et une transcription de 610 lignes est précisément ce qui fait
  mentir un harnais. La migration du jour n'ajoute qu'une policy de LECTURE sur une table nouvelle,
  donc elle ne peut affecter que ce qui a été rejoué ; la contrepartie est qu'un changement plus
  large exigera, lui, le fichier entier.
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
  défaut, et repartent de zéro à chaque changement (`<Outlet key>` dans la
  coque — sans quoi « Mes informations » gardait les réponses de la société
  précédente et « Enregistrer » les écrivait dans la nouvelle).
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
- **Interface d'ordinateur en trois volets, étape 1 (25/09/2026)** : barre latérale avec les
  dossiers et tous les écrans du dossier ouvert, réductible — voir « Architecture actuelle ». **Étape 2
  terminée le même jour** : le panneau contextuel à droite porte l'assistant (bouton « Assistant »
  dans l'en-tête du dossier, sur mobile la bulle et la carte flottante d'avant), la fiche d'une pièce
  et le rapprochement d'un mouvement bancaire, tels que les montre la maquette validée par le cabinet
  (artefact « Nouvelle interface PC »). Chaque étape part en ligne sur accord du cabinet, et c'est la
  feuille de route Notion (lignes 18.8 et 18.9) qui dit laquelle l'est : ce fichier voyage avec le
  code, donc il ne peut pas savoir si le commit qui le porte a été publié.
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
  **ET CE BALAYAGE REJOUÉ LE 21/09/2026 A RENDU DEUX SITES DE PLUS — MAIS SA LEÇON EST AILLEURS.**
  Sur 29 écritures dont le résultat est jeté, 23 sont suivies d'un rechargement, donc l'échec s'y
  voit. **SIX DES HUIT RESTANTES ÉTAIENT DES FAUX POSITIFS DU DÉTECTEUR**, et de la même façon à
  chaque fois : `const { error } = x ? await … : await …` — l'erreur EST lue, elle est simplement
  une ligne plus haut. **Quatrième fois qu'un balayage de ce dépôt se fait prendre par le retour à
  la ligne**, et la troisième dans la même journée : un détecteur qui lit « la ligne » plutôt que
  l'EXPRESSION rend ici 75 % de faux positifs.
  **C'est aussi pourquoi ce motif-là ne devient PAS un septième scanner**, et le dire vaut mieux que
  de le laisser deviner : le critère qui décide n'est pas la forme mais « quelque chose recharge-t-il
  derrière ? », et la réponse est OUI 23 fois sur 29. Un test qui refuserait les 29 serait du bruit,
  et un avertissement qui se trompe souvent finit par ne plus être lu. Le côté où l'absence de
  rechargement est STRUCTURELLE — les Edge Functions — a déjà le sien.
  **ET CETTE DÉCISION REPOSAIT SUR UN BALAYAGE INCOMPLET EN FORME — REJOUÉ LE 22/09/2026, ELLE TIENT.**
  Les deux balayages ci-dessus cherchaient `await supabase` et se sont fait prendre par le retour à la
  ligne (c'est écrit juste au-dessus) ; ils ne voyaient donc ni la chaîne multi-ligne, ni l'entrée d'un
  `Promise.all` jeté. Rejoué avec la logique complète en forme de `edgeFunctionsEcritures` — remontée à
  la tête de chaîne, deux portes — le compte tombe à **NEUF écritures de `src/` dont le résultat est
  jeté, et les NEUF sont suivies d'un `load()`**. Le critère qui décide reste donc satisfait partout, et
  le septième scanner reste inutile — mais il l'est maintenant pour une raison mesurée plutôt que pour
  une raison mesurée à moitié.
  **Le balayage a été éprouvé par plantation avant d'être cru** : une écriture multi-ligne et deux
  entrées d'un `Promise.all` jeté, posées dans `VirementsTab`, font passer le compte de 9 à 11. Sans
  cette vérification, « aucune faute » et « aveugle » seraient restés indiscernables — c'est exactement
  ce qui avait laissé vivre le trou du scanner des Edge Functions.
  **Les deux vrais cas :**
  - `SupplementsTab.supprimer` (un mouvement de compte courant) — sa fonction JUMELLE `ajouter`,
    trente lignes plus haut, dans le même composant et avec le même état d'erreur déjà affiché,
    lisait le sien. Exactement le couple `DocumentsTab.supprimer` / `supprimerSelection`. Le
    `onChanged()` qui suit recharge, donc la ligne réapparaît : c'est un signal, mais MUET et
    ambigu, sur une action que l'utilisateur vient de CONFIRMER — le réflexe est de reconfirmer et
    d'obtenir le même silence, défaut déjà payé sur `SuperPdpModal.retirer()`. Et le solde d'un
    compte courant est TOUJOURS recalculé depuis l'historique complet : une ligne qu'on croit
    retirée et qui reste est un solde que le cabinet croit faux.
  - `AuthContext.signOut` — **et ici c'est la SOURCE DE LA BIBLIOTHÈQUE qui corrige l'intuition**,
    comme pour `messageErreur`. Dans `GoTrueClient._signOut`, une erreur SERVEUR (réseau, 5xx)
    appelle `removeCurrentSession()` AVANT de rendre l'erreur : la session locale part quand même,
    et l'écran revient bien à la connexion. Le seul chemin qui laisse l'utilisateur connecté sans le
    dire est une erreur sur la LECTURE de la session locale, qui sort avant tout retrait — étroit,
    mais silencieux, et sur un poste de cabinet partagé c'est une session laissée ouverte derrière
    un bouton qui n'a rien fait de visible.
    **Ce qui est plus large que ce chemin étroit** : la portée par défaut est `global`, donc
    « Déconnexion » promet de fermer TOUTES les sessions du compte. Sur une erreur réseau la
    révocation côté serveur n'a PAS eu lieu, le jeton reste valide jusqu'à expiration, et rien ne le
    dit. **Journalisé plutôt que remonté**, et l'arbitrage est écrit : dans le cas courant l'écran
    est déjà reparti à la connexion, donc un message n'aurait personne à qui parler — mais l'avaler
    sans trace rendrait ce chemin indiagnosticable. C'est le précédent `tauxChange.tauxBce`.
  **Mesuré en base, et à moitié juste** : `memberships` porte `UNIQUE (user_id, dossier_id)`, donc
  deux « Entrée » rapprochés sur « Créer l'accès » (un `<form>`, le pire déclencheur) ne peuvent pas
  produire deux ACCÈS — la base rattrape. Il était écrit ici que ce site n'avait donc pas besoin de
  verrou ; **c'était faux**, et la Routine du 24/09/2026 l'a corrigé sur `main` : la base ne rattrape
  pas le doublon d'APPEL. Les deux `create-client-access` courent pour la même adresse, et le second
  échoue sur le compte que le premier vient de créer — un message d'erreur sur un accès bien créé.
  Le verrou existe depuis (voir la liste des porteurs plus bas).
- **ET LE BALAYAGE QUI A TROUVÉ QUATRE VERROUS EN ÉTAIT AVEUGLE À DEUX, PAR DEUX PORTES
  DIFFÉRENTES — DONT CELLE QUI CONSOMME UN NUMÉRO DE FACTURE** (23/09/2026). L'audit du 20/09/2026
  cherchait, dit ce fichier, « les gestionnaires `async` qui **dupliquent** quelque chose
  (`.insert(`, `functions.invoke`, `storage…upload`) et ne portent aucun `.current` ». Il rendait
  36 candidats et en retenait quatre. **Il ne pouvait pas en voir deux**, et les deux raisons sont
  indépendantes :
  - **la porte `.rpc(`** — `FactureFormModal.enregistrer` écrit par `enregistrer_facture`, une
    fonction SQL. C'est MOT POUR MOT la porte qu'`edgeFunctionsEcritures` avait manquée le
    21/09/2026 (« un client Supabase écrit par QUATRE portes »), manquée une seconde fois par un
    autre balayage ;
  - **le corps du gestionnaire au lieu de ce qu'il APPELLE** — `AjouterDocumentsModal.lancerImport`
    n'écrit rien lui-même : `importerFichierDossier` (src/lib) le fait pour lui. Le balayage lisait
    le texte du gestionnaire, donc ne voyait aucune écriture.
  Une seule panne sous deux noms, et c'est celle que ce dépôt connaît sous six autres : **une liste
  d'inclusion tenue à la main ne contient que ce à quoi quelqu'un a pensé**, et son silence est
  indiscernable d'un dépôt sain.
  **LE DIXIÈME PORTEUR EST LE PLUS CHER DES ONZE.** Deux « Valider la facture » rapprochés sur une
  facture NEUVE partent tous deux avec `p_facture_id = null` : `enregistrer_facture` prend sa branche
  INSERT deux fois, et chacune consomme son propre numéro de la suite annuelle
  (`attribuer_numero_facture`, upsert +1). **DEUX factures validées, identiques, numérotées à la
  suite, toutes deux IMMUABLES** — l'écran ne propose la suppression que sur un brouillon, et la
  seule sortie légale est un avoir. C'est le dégât que le commentaire de `FactureAvoirModal` nomme
  pour justifier SON verrou, sur le document plus gros des deux, dans le fichier voisin.
  **Sur un brouillon EXISTANT la base rattrape**, et c'est mesuré dans la définition de la fonction
  plutôt que supposé : le `select … for update` sérialise les deux appels, et le second se fait
  refuser « Une facture validée ne peut plus être modifiée ». C'est la création qui n'a aucun filet —
  même arbitrage que `memberships UNIQUE (user_id, dossier_id)`, qui rattrape « Créer l'accès ».
  **LE ONZIÈME EST LE JUMEAU EXACT DU DÉFAUT D'ORIGINE DE CETTE FAMILLE**, à une nuance de forme
  près : le bouton d'`AjouterDocumentsModal` n'est pas `disabled`, il est RENDU SOUS CONDITION
  (`peutImporter && !running`) — `running` étant un état React, les deux clics du même rendu le
  voient tous deux. Chaque exécution repart alors avec SON `chargerHashsExistants`, donc deux boucles
  parallèles aveugles l'une à l'autre : le dédoublonnage ne rattrape que les paires où le minutage
  joue en sa faveur (**141 lignes pour 78 fichiers** sur l'import réel qui a fait naître la famille).
  **Et c'est pire qu'à l'origine** : `ImportDossierModal` importe une arborescence, geste rare et
  délibéré ; celui-ci est le POINT D'ENTRÉE UNIQUE, ouvert depuis Pièces comme depuis Documents.
  **ET LE TEST A FAIT SORTIR UN TROISIÈME DÉFAUT, EN DEUX COPIES — LES DEUX MODALES D'IMPORT
  AVALAIENT L'EXCEPTION QUE `chargerHashsExistants` LÈVE EXPRÈS.** Leur `try` n'avait AUCUN `catch` :
  sur une lecture d'empreintes tronquée ou refusée — le cas pour lequel cette fonction a été écrite
  pour lever, « mieux vaut lever que conclure pas encore importé » — l'exception s'échappait d'un
  gestionnaire d'`onClick`, que personne n'attend. Rejet non capturé, **aucun message** (ni l'une ni
  l'autre n'avait d'état d'erreur), et le `finally` posait quand même `done`, c'est-à-dire
  l'affichage de FIN : zone de dépôt masquée, bouton de gauche passé à « Fermer », fichiers restés
  « en attente ». Recliquer rendait le même silence — le défaut de `SuperPdpModal.retirer`.
  **Dans `ImportDossierModal` la fausse bonne nouvelle était ÉCRITE** : son résumé ne s'affiche que
  si `done`, et il annonçait alors « 0 importé(s), 0 déjà importé(s), **0 en erreur** » — zéro
  erreur, précisément quand tout avait échoué. Le pire sens de « le vide est une AFFIRMATION ».
  `done` ne se pose plus que sur un parcours mené à son terme, et la cause est nommée. `onImported()`
  reste dans le `finally` : un échec en cours de boucle laisse de vrais imports derrière lui.
  **CE TROISIÈME MOTIF NE DEVIENT PAS UN SCANNER, et c'est MESURÉ plutôt que supposé** : la forme
  `try { … } finally { … }` sans `catch` dans un gestionnaire async existe **sept fois** ailleurs
  dans `src/`, et **les sept sont correctes**. Le critère n'est pas la forme mais « ce corps
  peut-il lever jusqu'ici ? » — `relireDocuments` et `relireTextesDocuments` attrapent par document
  (un échec n'interrompt pas le lot, règle écrite), `rapprocherTout` passe par `Promise.allSettled`
  et annonce ses échecs, et les quatre autres n'appellent rien qui lève. Un contrôle qui crierait
  sur les sept serait du bruit, et un avertissement qui se trompe finit par ne plus être lu.
  **LATENT, et mesuré** : 6 factures en base, toutes validées, aucune en double ; 0 avoir.
  Comme toute cette famille, ce qui les rend dignes d'être corrigés n'est pas un préjudice constaté
  mais qu'aucun ne PEUT se voir une fois arrivé.
  **ONZE MUTATIONS, TOUTES MORDENT, et la DISCRIMINATION est le résultat** : le code TEL QU'IL ÉTAIT
  fait tomber trois tests côté facture et deux côté import ; le verrou posé DANS le `try` n'en fait
  tomber qu'UN de chaque côté, celui à trois envois — exactement ce qu'il est censé distinguer ; le
  verrou jamais relâché, le `catch` retiré, `done` reposé dans le `finally` et les deux gardes
  symétriques en font tomber un chacun.
  **ET UNE MUTATION A SURVÉCU D'ABORD, ACCUSANT MON ASSERTION** : le garde symétrique
  d'`AjouterDocumentsModal` visait le REPLI de `messageErreur` (« L'import n'a pas pu démarrer »),
  qui n'apparaît que si l'erreur est renseignée — donc un paragraphe d'erreur affiché en PERMANENCE
  avec un message vide passait. Il porte désormais sur la phrase que ce paragraphe porte TOUJOURS.
  **ET LE TEST DE RELÂCHEMENT A DÛ CHANGER DE SCÉNARIO**, la première mutation ne mordant pas :
  reprendre un SECOND LOT n'est pas producible (la zone de dépôt est masquée par `done`, donc ajouter
  des fichiers demande de rouvrir la modale, ce qui remonte le composant et remet le `useRef` à
  zéro). Le seul chemin où l'import se rejoue dans le même montage est celui de l'ÉCHEC, où les
  fichiers restent « en attente » et le bouton revient — c'est-à-dire le chemin du troisième défaut
  ci-dessus, trouvé en cherchant à faire mordre une mutation.

- **UNE SUPPRESSION SE CONFIRME, ET LA CONFIRMATION NOMME CE QU'ON PERD** (balayage du 21/09/2026,
  jamais fait jusque-là). Vingt-six suppressions dans `src/`, **neuf sans confirmation** — et sept
  s'expliquent : trois vivent dans `src/lib` et sont confirmées par l'écran qui les appelle
  (`FilCommentaires`, `ConfirmationSuppression`), une est un effet de bord interne
  (`retirerContrepartieBanque`), une est un TOGGLE réversible d'un clic (l'assignation d'un membre
  d'équipe), et deux ne sont pas des suppressions nues mais un déplacement (`convertirEnPiece`) et
  une régénération idempotente (`regenererEcriture`).
  **Les deux vraies étaient les deux qui effacent un travail humain :**
  - `VehiculesCard.supprimer` — et le bouton « Retirer » vit dans la MÊME LIGNE que le champ des
    kilomètres qu'on vient d'éditer. Un clic distrait effaçait le véhicule, sa puissance fiscale et
    son kilométrage, tous saisis à la main — or ces kilomètres décident de la case BJ de la 2035,
    donc la déduction disparaissait sans que personne ne la cherche. **C'était la seule suppression
    de données SAISIES du projet à partir sans rien demander.**
  - `AccesTab.revoke` — couper l'accès d'un client, dans une colonne d'actions où « Retirer »
    voisine « Relancer ». Réversible, mais pas d'un clic : il faut recréer l'accès ET communiquer un
    nouveau mot de passe.
  **Le message NOMME ce qui part**, comme les quatorze confirmations déjà en place (« et tous ses
  mouvements », « La pièce redevient une charge courante ordinaire ») : « Êtes-vous sûr ? » se ferme
  en un clic aussi distrait que le premier, et un test le garde nommément sur les deux écrans.
  **`AccesTab` et Suppléments entrent dans les écrans testés par un défaut trouvé**, jamais par
  méthode — huit mutations mordent sur les deux, dont chaque code tel qu'il était et, des deux
  côtés, le garde SYMÉTRIQUE : sans lui, « on ne supprime pas sans confirmation » serait satisfait
  par un bouton qui ne supprime JAMAIS, et « l'écran n'affirme pas qu'il n'y a personne » par un
  écran qui crie à l'erreur sur un dossier neuf.
- **ET CE BALAYAGE S'ÉTAIT ARRÊTÉ À `src/` — LES EDGE FUNCTIONS N'AVAIENT JAMAIS ÉTÉ REGARDÉES**
  (21/09/2026). Le même motif y est BIEN PLUS COÛTEUX, et pour une raison structurelle : la question
  qui décide dans `src/` est *quelque chose recharge-t-il derrière ?*, et la réponse y est presque
  toujours oui. **Dans une Edge Function elle est presque toujours non** — rien ne recharge,
  l'appelant reçoit le code de retour que la fonction a décidé d'écrire, et une écriture ratée ne
  laisse aucune trace nulle part.
  **Six sites, quatre qui comptent, et les quatre portent sur une action DÉJÀ IRRÉVERSIBLE au moment
  de l'écriture** :
  - `send-email` — le journal `emails_envoyes`, écrit APRÈS que Resend a accepté l'e-mail. L'échec
    rendait un journal muet, indiscernable d'un envoi qui n'a pas eu lieu, pendant que l'appelant
    lisait `ok: true`. C'est exactement ce que cette table existe pour empêcher, son en-tête disant
    « un cabinet doit toujours pouvoir retrouver qui ».
  - `create-cabinet` — les DEUX compensations, c'est-à-dire les `delete` qui retirent le cabinet
    quand la création du compte ou du `cabinet_admins` a échoué. **Une compensation qui échoue en
    silence laisse exactement le fantôme qu'elle existe pour éviter** : le super-admin ne lit que
    l'erreur d'ORIGINE, recommence avec une autre adresse, et le cabinet vide reste. Le commentaire
    du code nommait déjà ce fantôme comme le dégât à empêcher ; il ne vérifiait pas l'avoir empêché.
    D'où `retirerCabinet`, qui REND la phrase à ajouter à l'erreur plutôt que de seulement
    journaliser : un log d'Edge Function n'est lu que par quelqu'un qui sait déjà qu'il y a un
    problème, et ici personne ne le saurait.
  - `superpdp-emit` — les événements et le dernier statut. Le retour vient de l'API Super PDP et non
    de la base, donc l'échec ne se voit pas tout de suite : c'est à la RÉOUVERTURE de la modale, qui
    relit la table, que l'historique se révèle vide sous un statut bien présent.
  **LATENTS, et mesurés** : 0 cabinet sans admin, 0 e-mail journalisé, 0 événement Super PDP. Rien
  n'a été perdu — ce qui les rend dignes d'être corrigés est qu'aucun des quatre ne PEUT se voir une
  fois arrivé, sur des actions qu'on ne rejoue pas.
  **La règle devient un test** (`edgeFunctionsEcritures.test.ts`), qui part de TOUTES les fonctions
  comme `rls.sql` part de `pg_class`. Il ne garde PAS ce qu'on fait de l'erreur — journaliser,
  remonter ou compenser est un arbitrage par site — seulement qu'elle ne soit pas jetée. Les lectures
  s'écartent d'elles-mêmes par leur forme : une lecture est toujours destructurée, sinon elle ne sert
  à rien. Cinq mutations mordent, dont les trois défauts d'origine replantés un par un ; « le scanner
  devient aveugle » en fait tomber DEUX, les deux bornes posées pour que « zéro faute » et
  « aveugle » restent distinguables.
  **LES TROIS SONT EN PRODUCTION** (21/09/2026) : `create-cabinet` v3, `send-email` v2,
  `superpdp-emit` v9 — chacune déployée avec son `verify_jwt` relu et repassé explicitement (règle
  ci-dessous), et vérifiée par aller-retour. Sur `superpdp-emit`, 417 lignes, **zéro différence
  résiduelle**.
  **Et la comparaison AVANT écrasement, celle qui se saute, a rendu son résultat utile** : le
  déployé était identique au dépôt moins le correctif, aux deux écritures près — donc personne
  n'avait modifié la production à la main, et il n'y avait aucun correctif non déployé à embarquer
  au passage (le cas qui avait trouvé `extract-piece` en retard de trois correctifs).
  **ET CE SCANNER NE REGARDAIT QU'UNE PORTE SUR QUATRE — TROIS SITES DE PLUS LE LENDEMAIN**
  (21/09/2026). Il cherchait `.from(`, la forme des quatre sites du jour d'avant. Or un client
  Supabase écrit par QUATRE portes : `.from(` (les tables), `.rpc(` (les fonctions SQL, qui écrivent
  aussi), `.auth.` (les comptes) et `.storage.` (les fichiers). Le balayage des trois autres a rendu
  trois sites, et **le premier est le plus coûteux de toute la famille** :
  - `create-client-access` et `create-team-member` — `auth.admin.updateUserById(id, { password })`
    sur un compte RÉUTILISÉ, résultat jeté. La fonction répondait ensuite `ok: true`, et le cabinet
    communiquait au client un mot de passe **qui n'avait jamais été posé**. Rien ne le dit : le
    compte existe, l'accès existe, tout a l'air en ordre — et le symptôme, « je n'arrive pas à me
    connecter », ressemble à une erreur du client. Le commentaire juste au-dessus énonçait pourtant
    la garantie que l'échec brise : « le mot de passe saisi dans le formulaire doit rester celui à
    donner au client ».
    **On REFUSE avant de créer l'accès plutôt que d'avertir après**, et c'est le point de la
    correction : à cet endroit rien d'irréversible n'a eu lieu (le compte préexistait, aucun
    `membership` ni `cabinet_admins` n'est encore écrit), donc échouer laisse un état propre et le
    nouvel essai est le geste naturel. Le message dit explicitement de ne pas communiquer ce mot de
    passe tant qu'il revient.
  - `receive-email` — le retrait du fichier quand l'insertion échoue. **Une compensation dont on
    jette le résultat laisse exactement l'orphelin qu'elle existe pour éviter**, mot pour mot le
    défaut des deux `delete` de `create-cabinet`, sur la troisième copie du même geste (les deux
    autres, `depot.ts` et `importFichiers.ts`, sont côté `src/`).
  **Mesuré avant de corriger, et le résultat est NÉGATIF** : sur les 151 objets des trois seaux,
  **deux seulement ne sont référencés par aucune table, et ce sont des fixtures d'essai RLS**
  (`11111111-…/logo-test.png`, `11111111-aaaa-…/test-piece.pdf`, déposées le 08/09) — zéro orphelin
  de production. Comme les autres de cette famille, ce qui rend ces sites dignes d'être corrigés
  n'est pas un préjudice constaté mais qu'aucun ne PEUT se voir une fois arrivé.
  **Cinq mutations mordent**, dont **le défaut d'origine replanté — ramener la regex à `.from(`
  seul —, qui fait tomber QUATRE tests** : sans les cas synthétiques d'une écriture par `.rpc(`, par
  `.auth.` et par `.storage.`, rétrécir ce scanner serait resté entièrement vert. C'est la panne que
  ce dépôt connaît sous un autre nom : **une liste d'inclusion tenue à la main ne contient que ce à
  quoi quelqu'un a pensé**, et son silence est indiscernable d'un dépôt sain.
  **LES TROIS SONT EN PRODUCTION** le jour même : `create-team-member` v3, `create-client-access`
  v10, `receive-email` v6 — chacune avec son `verify_jwt` relu et repassé à `false`, et vérifiée par
  aller-retour (179, 207 et 276 lignes, zéro différence résiduelle). La comparaison AVANT écrasement
  a rendu trois fois le même résultat : déployé identique au dépôt moins le correctif.
- **ET LA QUESTION QUI DÉCIDE N'A JAMAIS ÉTÉ POSÉE DU STOCKAGE** (21/09/2026). Le balayage du
  20/09/2026 demandait *quelque chose recharge-t-il derrière ?* et répondait « presque toujours oui ».
  C'était vrai des TABLES : un `load()` suit, la ligne supprimée réapparaît, l'échec se voit.
  **Pour le STOCKAGE la réponse est TOUJOURS non** — aucun écran de ce projet ne relit jamais un seau.
  Neuf retraits de fichier, dont **sept en `.remove([...]).catch(() => {})`**, c'est-à-dire la façon
  la plus explicite possible de dire qu'on ne veut pas savoir. Trois étages, et ils ne coûtent pas la
  même chose :
  - **`suppressionDossier.ts` — le pire, et de loin.** Ni `list()` ni `remove()` ne lisaient leur
    `{ error }`, et un `catch {}` avalait le reste. Or **une lecture refusée rend `data: null`,
    indiscernable d'un dossier vide** (famille déjà nommée : « une lecture dont l'échec ressemble à un
    résultat vide ») : ZÉRO fichier retiré, pendant que l'écran annonçait une suppression propre.
    **C'est le geste auquel se ramène une demande d'effacement**, et les données de patients sont dans
    les FICHIERS, pas dans les tables (RGPD.md §4) — le cabinet croyait avoir effacé ce qui était
    toujours là. Et la ligne `dossiers` venant de partir, plus aucun écran ne peut les retrouver.
    La fonction REND désormais un bilan (`demandes`, `retires`, `echecs`, `inventaireIncomplet`) et
    reste non bloquante — mais **non bloquant n'est pas muet** : l'écran retient la navigation et dit
    ce qui reste, parce que naviguer tout de suite emporterait le message avec l'écran et que c'est la
    seule occasion de le lire. `inventaireIncomplet` porte la phrase de `packGenerator` appliquée
    ailleurs : **on ne peut pas recenser ce qu'on n'a pas lu**, donc on dit qu'on ne sait pas plutôt
    que d'annoncer un compte faux.
  - **`depot.ts` et `importFichiers.ts` — les DEUX JUMEAUX de la compensation de `receive-email`**,
    corrigée une heure plus tôt. Les corriger le même jour n'est pas du zèle : « chercher toutes les
    copies avant de corriger la première » est une règle de ce fichier, et s'arrêter à la première
    aurait été exactement le défaut qu'elle décrit. Journalisés avec le CHEMIN — chaque nouvel essai
    dépose un fichier de plus, l'horodatage étant dans le nom.
  - **Les quatre écrans (`PiecesTab`, `PieceFormModal`, `DocumentsTab`, `CabinetBrandingPage`) passent
    par un point unique**, `lib/stockage.ts::retirerFichiers`, qui journalise au lieu de bâtir un
    message par écran. **Et l'arbitrage est écrit plutôt que tu** : ici le résidu reste sous
    `dossierId/`, donc la suppression du dossier finira par le ramasser, et le geste de l'utilisateur
    est bien accompli ET visible (la ligne a disparu). C'est la différence avec la suppression d'un
    dossier, où plus rien ne repassera jamais. Un best-effort journalisé satisfait la règle du projet
    — c'est le précédent `tauxChange.tauxBce`, déjà admis comme légitime.
    Le `catch` reste nécessaire et il est gardé par un test : **`remove()` rend `{ error }` sur un
    refus du serveur mais REJETTE sur une coupure réseau**, et les deux laissent le même fichier.
  **ET UN DÉFAUT DE PLUS, TROUVÉ EN LISANT CES NEUF LIGNES : `DocumentsTab.supprimer` retirait le
  fichier MÊME QUAND LA LIGNE N'ÉTAIT PAS PARTIE** (`await supabase.from(...).delete()` sans
  destructuration). Une suppression refusée laissait donc une ligne bien visible qui désigne un
  fichier disparu — **pire qu'un orphelin** : le téléchargement casse, et l'empreinte SHA-256 que la
  piste d'audit donne pour preuve ne vérifie plus rien. Sa fonction JUMELLE trente lignes plus bas
  (`supprimerSelection`) testait déjà `deleteError` ; celle-ci, non.
  **LATENT, et mesuré** : sur les 151 objets des trois seaux, **deux seulement ne sont référencés par
  aucune table, et ce sont des fixtures d'essai RLS** — zéro orphelin de production.
  **Ce que la couverture ajoute, et pourquoi il en fallait DEUX SORTES** : `suppressionDossier.test.ts`
  (13 tests, 6 mutations) garde le CALCUL — la fonction sait dire ce qu'elle n'a pas retiré ;
  `InformationsTab.test.tsx` (3 tests, 4 mutations) garde le CÂBLAGE, que jamais aucun test de
  `src/lib` ne pourrait voir — que l'écran le MONTRE au lieu de naviguer. La mutation qui compte est
  celle qui remet le code TEL QU'IL ÉTAIT (« on navigue toujours ») : elle fait tomber deux des trois
  tests, le troisième étant le garde symétrique — sans lui, « l'écran ne navigue pas » serait satisfait
  par un écran qui ne navigue JAMAIS.
  **ET LA RÈGLE NE RESTE PAS DANS CE FICHIER : elle est devenue un test** (`retraitsStockage.test.ts`),
  comme `verrousExecution` et `lecturesPaginees` avant elle. Il part de TOUTE source de production de
  `src/`, refuse tout `.storage…remove(` hors du point unique, et n'admet que des exceptions écrites
  portant **la raison pour laquelle `retirerFichiers` ne convient pas** — deux à ce jour, et toutes
  deux ont besoin du RÉSULTAT, que le point unique ne rend pas.
  Il porte une **seconde règle, sans aucune exception** : plus aucun `.catch(() => {})` dans une
  source de production. Il n'existe pas de cas où cette forme soit correcte — vouloir ignorer un échec
  se dit en le journalisant — et elle était présente sept fois. Même statut que le ternaire interdit
  par `erreursSupabase.test.ts`.
  **Et il a fallu lui apprendre à lire les commentaires de ce dépôt** : `stockage.ts` CITE
  `.catch(() => {})` en toutes lettres pour expliquer pourquoi c'est interdit, donc le scanner
  retirerait cette ligne-là. Il ne coupe QUE les lignes entièrement en commentaire, jamais un
  commentaire de fin de ligne : le code fautif serait de toute façon AVANT le `//`, et couper là
  risquerait d'avaler une chaîne contenant `//` (une URL) — c'est-à-dire de rendre le scanner aveugle
  sur cette ligne, le seul sens dangereux.
  Sept mutations mordent, dont le défaut d'origine replanté sur un vrai écran, l'exception INVENTÉE
  (qui ne correspond à aucun retrait réel), et le retrait du filtrage des commentaires.
  **Les deux jumeaux `depot.ts` / `importFichiers.ts` ont rejoint le point unique dans la foulée**, et
  ce n'était pas cosmétique : leur version en ligne laissait un rejet réseau du RETRAIT remonter à la
  place de l'erreur d'INSERTION, c'est-à-dire remplacer la seule explication utile à l'utilisateur par
  une autre, survenue après. `retirerFichiers` ne lève jamais, et c'est un test qui le fige.
  **LE MÊME BALAYAGE PORTÉ AUX TROIS AUTRES PORTES DE `src/` REND UN RÉSULTAT PRESQUE ENTIÈREMENT
  NÉGATIF — à garder, pour ne pas le refaire** (21/09/2026) : les 3 `.rpc(`, les 6 `upload()` et 6 des
  7 `createSignedUrl()` lisent tous leur erreur. `AuthContext` lit `is_super_admin` sans erreur, et
  c'est LÉGITIME — la lecture échoue en « pas super-admin », donc du côté fermé.
  **La septième était en faute, et c'est la pire des sept possibles** : `InformationsTab`, l'export
  fait « juste avant une suppression définitive » (son propre commentaire le dit). `const { data:
  signed } = …` puis `if (signed)` : sur un échec, **le bouton ne fait VISIBLEMENT RIEN** — aucun
  onglet, aucun message. L'archive est pourtant bien générée et enregistrée ; l'opérateur, lui, en
  conclut le contraire au moment précis où il s'apprête à tout supprimer, et relance.
  Le message dit désormais les trois choses qui manquaient : que l'archive EXISTE, la raison de
  l'échec, et **où la reprendre** (onglet Packs). Il s'AJOUTE à l'avertissement des pièces manquantes
  au lieu de l'écraser — les deux comptent, et celui-là se lit avant de supprimer quoi que ce soit.
  Quatre mutations mordent, dont le code tel qu'il était.
- **UNE MISE EN GARDE ÉCRITE AU-DESSUS D'UN CODE QUI JETTE LE DRAPEAU PERMETTANT DE LA VOIR**
  (`chargerCommentaires`, 21/09/2026). Son commentaire disait, depuis le début : « Tronquée, elle
  ferait disparaître la précision du client sur les pièces les plus récentes — précisément celles
  qu'on est en train d'arbitrer. » Et la fonction ne reprenait que `lignes` de `lireTout` : `complete`
  et `motif` partaient à la poubelle. **Elle nommait le dégât sans pouvoir le signaler.**
  Ce que ça coûte est exactement ce que la fonctionnalité existe pour éviter : une liste plus courte
  est INDISCERNABLE d'un client qui n'a rien écrit, donc le cabinet catégorise sans lire la précision
  — et le décroche le téléphone, « la chose la plus chère de toute la chaîne ».
  **DEUX bandeaux, pas un**, dans les deux écrans qui lisent ce fil (`PiecesTab`, `ClientUpload`) :
  la raison d'être de `BandeauLecturePartielle` est de dire CE QUI est devenu faux, et ce n'est pas
  la même chose pour une liste de pièces tronquée que pour un fil de précisions tronqué. Les fondre
  afficherait, sur l'un des deux cas, une conséquence qui n'est pas la sienne — et un test garde
  précisément ça (pièces tronquées ⇒ le bandeau des précisions se tait).
  **LATENT au sens le plus fort : `piece_commentaires` est VIDE** (0 ligne, tous dossiers confondus)
  — la fonctionnalité est livrée, pas encore exercée. Le critère reste celui du projet : cette
  collection peut-elle grandir ? Une ligne par message, donc oui, sans borne.
  **Trouvé par balayage** : les douze lectures de `src/` dont l'erreur (ou le `complete`) n'est pas
  lue. Les onze autres sont légitimes et le résultat est à garder — `is_super_admin` et les rôles
  d'`AuthContext` échouent du côté FERMÉ, et `texteOcrDe` est le chemin d'AFFICHAGE, dont le jumeau
  destructeur `lireTexteOcrDuDocument` rend déjà son erreur.
  **ET LA MUTATION QUI A SURVÉCU DIT QUELQUE CHOSE D'UTILE** : retirer `count: 'exact'` laisse
  `commentaires.test.ts` vert, parce que son faux client annonce un compte quoi qu'on demande.
  Ce n'est pas un trou — `lecturesPaginees.test.ts` l'attrape, nommément, sur TOUTE source de
  production. Le modéliser une seconde fois dans ce faux client dupliquerait une garantie déjà
  exhaustive ; c'est dit ici plutôt que masqué par un test de complaisance.
- **ET LA MÊME LECTURE SERT À REMPLIR UN FORMULAIRE QU'ON RÉENREGISTRE ENSUITE — LÀ, ELLE ÉCRASE**
  (21/09/2026). Le balayage de `chargerCommentaires` avait classé onze lectures « légitimes » en n'en
  nommant que trois. Rejoué en les regardant une par une, il rend **dix-neuf** sites (dont sept
  `auth.getUser()`, traités par `?? null` partout) et **quatre vrais défauts**, tous de la même
  famille et tous invisibles pour la même raison : le résultat d'une lecture ratée ressemble
  exactement au résultat d'une lecture réussie qui ne trouve rien.
  **LE MOTIF LE PLUS COÛTEUX EST « LECTURE → FORMULAIRE → UPSERT DE TOUS LES CHAMPS »**, et il
  existait en TROIS copies. Une lecture qui échoue laisse le formulaire sur ses valeurs INITIALES,
  donc identique à celui d'un dossier neuf, et le premier « Enregistrer » réécrit par-dessus :
  - `InformationsTab` et `ClientInformations` — jumeaux au caractère près. `vehicule_type` retombe à
    « aucun », or il commande le forfait kilométrique, donc la case BJ de la 2035 ; `notes` est du
    texte libre que personne ne relit, donc que personne ne verrait disparaître. **Les 3 lignes en
    base portent toutes un véhicule, des jours travaillés et des avantages** : il y aurait eu de quoi
    détruire sur 3 sur 3.
  - `CabinetBrandingPage` — la pire des trois, et pas pour la raison qu'on croit : `logoStoragePath`
    repart de `cabinet?.logo_storage_path ?? null`, donc l'enregistrement **EFFACE le chemin du
    logo**. Le fichier reste dans le seau, plus rien ne le désigne — un orphelin fabriqué par
    l'écran, et une charte de cabinet remplacée par celle d'origine.
  **CE QUE LE CORRECTIF GARDE ET CE QU'IL NE GARDE PAS, mesuré plutôt que supposé** : un refus RLS
  rend **ZÉRO LIGNE ET AUCUNE ERREUR** (impersonation d'un compte rattaché à rien, sur la base
  réelle), donc il reste indiscernable d'un dossier neuf et **aucun code ne peut l'attraper ici**.
  Ce que lire l'erreur attrape, et qui suffit à produire le dégât : session expirée, coupure réseau,
  5xx, colonne renommée. Le couple habituel — une moitié gardée par le code, l'autre annoncée.
  **Les deux autres défauts sont des LISTES dont le vide est une AFFIRMATION**, ce qui est la même
  panne sous une autre forme : `AccesTab` disait « Aucun accès client pour ce dossier » sur une
  lecture refusée — le pire sens possible pour ce geste-là, puisqu'on coupe l'accès d'un client qui
  part et qu'on croit l'avoir fait ; et `SuperPdpFactureModal` disait « Aucun événement pour
  l'instant » sur une facture partie chez une plateforme agréée DGFiP, c'est-à-dire **le symptôme
  exact que ce fichier décrit déjà pour une écriture d'événement perdue** — les deux causes étaient
  indiscernables, donc le diagnostic annoncé plus haut ne pouvait même pas se poser.
  `revoke()` lit désormais son erreur aussi : le `load()` qui suit montre normalement l'échec (la
  ligne réapparaît), **sauf quand il échoue pour la MÊME raison** — la liste se vide alors au lieu
  de garder sa ligne, ce qui retourne le signal.
  **Le module partagé (`lib/informationsDossier.ts`) n'existe pas pour dédupliquer** mais pour que la
  correction ne puisse pas diverger entre deux jumeaux, et pour rendre la chose testable. Deux sortes
  de couverture, comme pour la suppression d'un dossier : le module garde le CALCUL (13 tests,
  6 mutations, dont le défaut d'origine replanté qui en fait tomber trois), l'écran garde le CÂBLAGE
  (3 tests, 4 mutations sur 5). **La cinquième survit à juste titre** — retirer la seconde ceinture
  du gestionnaire ne se voit pas, un bouton grisé n'appelant pas son gestionnaire et la soumission
  implicite ne trouvant pas de bouton par défaut actif. C'est écrit dans le test plutôt que déguisé
  en assertion de complaisance, comme pour `ClotureTab`.
  **Les huit lectures restantes sont légitimes, et le résultat est à garder** : les quatre
  d'`AuthContext` échouent du côté FERMÉ, `auth.getUser()` est traité par `?? null` partout, et
  `texteOcrDe` est le chemin d'AFFICHAGE dont le jumeau destructeur `lireTexteOcrDuDocument` rend
  déjà son erreur.
  **ET CETTE VÉRIFICATION-LÀ A ÉCHOUÉ DEUX FOIS DANS LA MÊME JOURNÉE, DONC ELLE DEVIENT UN TEST**
  (`lecturesVerifiees.test.ts`). Elle avait été faite le matin — onze lectures déclarées légitimes,
  trois nommées — puis refaite l'après-midi en les ouvrant une par une : quatre défauts dedans. C'est
  mot pour mot « une vérification qu'il faut penser à rejouer, et dont personne ne peut voir qu'elle
  est fausse, ne vaut rien ». Le scanner part de TOUT `await supabase` de `src/` et n'admet que des
  exceptions écrites portant leur raison — deux à ce jour, et le critère est unique : **l'échec
  tombe-t-il du côté FERMÉ ?** Ne rien savoir qui revient à ne rien accorder est légitime ; ne rien
  savoir qui produit une AFFIRMATION ne l'est pas.
  **`auth.getUser()` est écarté NOMMÉMENT, jamais `.auth.` en entier**, et c'est la leçon
  d'`edgeFunctionsEcritures` appliquée à l'envers : cette porte-là écrit des comptes, et c'est
  derrière elle qu'un mot de passe jamais posé se cachait sous un « ok ». Un cas synthétique
  (`auth.admin.listUsers`) garde précisément cet élargissement.
  **IL REMONTE LES ACCOLADES, IL NE LIT PAS « LA LIGNE » — et c'est son propre cas synthétique qui
  l'a exigé.** Sa première version lisait le texte depuis le début de la ligne portant
  `await supabase`, et ratait donc ENTIÈREMENT une destructuration coupée sur plusieurs lignes,
  c'est-à-dire le formatage normal de ce dépôt. **Troisième fois qu'un scanner de ce projet se fait
  prendre par le retour à la ligne** (après le grep des lectures paginées, puis le test qui l'a
  remplacé). Six mutations mordent, dont ce défaut-là replanté et l'exception INVENTÉE.
- **ET CE SCANNER-LÀ NE REGARDAIT QU'UNE LECTURE SUR DEUX FORMES — HUIT FAUTES DERRIÈRE, DONT UNE
  QU'IL AVAIT CORRIGÉE LA VEILLE À SIX LIGNES DE LÀ** (22/09/2026). `lecturesVerifiees.test.ts` part
  de `await supabase`. Or **une lecture s'écrit aussi SANS `await`** : comme entrée d'un
  `Promise.all([...])` — le chargement normal d'un écran de ce dépôt — et comme chaîne
  `.then(({ data }) => …)` dans un `useEffect`. C'est la panne que ce dépôt connaît sous cinq autres
  noms : **son silence était indiscernable d'un dépôt sain**.
  **Mesuré : 14 lectures nues, 8 en faute**, toutes de la famille que ce scanner existe pour garder.
  - **`FinancementTab` était la QUATRIÈME copie de « lecture → formulaire → upsert de tous les
    champs »**, et c'est ce qui rend le trou coûteux plutôt qu'embarrassant : les trois premières
    (`InformationsTab`, `ClientInformations`, `CabinetBrandingPage`) ont été corrigées le 21/09/2026
    PAR CE SCANNER, et celle-ci a survécu un jour de plus **dans le même `Promise.all` que six
    lectures qu'il voyait**. Une lecture refusée rendait `previsionnel` nul — exactement l'écran
    d'un dossier qui n'a jamais rien enregistré, bouton « Générer » compris — et le premier
    enregistrement écrasait les deux taux ET `note_hypotheses`, du texte libre que personne ne relit
    donc que personne ne verrait partir. Sur le document qu'un cabinet montre à une banque.
  - **`ClotureTab` produisait une 2035 SIGNÉE sans identité de déclarant.** `nom`, `libelle_naf` et
    `siret` sont recopiés tels quels dans le formulaire ; la lecture refusée les rendait nuls, et
    rien ne le disait. Son échec rejoint donc `lectureIncomplete`, le drapeau qui refuse déjà le
    remplissage — ce n'est pas une lecture « partielle » au sens du plafond PostgREST, mais le refus
    qu'elle appelle est exactement le même. Sa seconde lecture nue (`exercices_clotures`) passe
    désormais par `lireAnneesCloturees`, qui rend son erreur : **une table lue par trois écrans ne
    doit pas avoir une copie qui la lit autrement**.
  - **`FactureApercu` imprimait une facture SANS LIGNES sous des totaux bien présents** — un
    document qui se contredit lui-même, sur le seul artefact légal que cet écran produise, et qui
    part au client par la boîte d'impression du navigateur.
  - **`FactureFormModal`** affirmait « cette facture n'a aucune ligne » : `enregistrerFacture`
    REMPLACE le jeu de lignes, donc le seul geste que l'écran propose alors — les retaper — détruit
    celles qu'on n'a pas su lire et recalcule l'en-tête dessus. Le formulaire ne s'ouvre plus.
  - **`FactureAvoirModal`, et ici je me suis corrigé par l'exécution** : j'avais écrit qu'il créait
    un avoir vide en consommant un numéro de la série « A ». **C'est FAUX** — la garde
    `lignesValides.length === 0` est posée AVANT `attribuerNumeroFacture` et elle tient. Ce que ça
    coûte est plus étroit et reste réel : cet écran n'a aucun bouton « + Ligne », donc un tableau
    vide sous « les lignes ci-dessous sont pré-remplies pour un avoir total », et un refus qui dit
    « Au moins une ligne avec une quantité doit rester à créditer » — **un reproche à l'opérateur
    pour une panne de lecture**, sur la seule façon légale de corriger une facture validée.
  - **`ChecklistTab`** réclamait « Informations complémentaires du client » sur une lecture refusée,
    c'est-à-dire envoyait relancer un client pour des informations déjà saisies, sur l'écran dont
    c'est le métier de dire ce qui manque. Il passe par `chargerInformationsDossier`, le module écrit
    pour les deux premières copies — **troisième copie, et la seule qui jetait encore son erreur**.
  **LA RÈGLE EST LA MÊME POUR LES TROIS PORTES, et elle tient en une phrase : qui prend `data` prend
  `error`.** Un résultat gardé ENTIER (`const r = …`, puis `r.error`) reste légitime — c'est ce que
  fait `fichierDejaPresent`, et un test synthétique garde ce cas pour que le scanner ne le crie pas.
  **QUATRE LECTURES NUES SONT LÉGITIMES, résultat à garder pour ne pas les réenquêter** : `branding`
  (sans réponse, la charte PAR DÉFAUT s'applique — et l'écran qui l'ÉCRIT lit bien son erreur),
  `ClientHome` (le dossier n'y sert qu'à la ligne d'accueil), `extraction.fichierDejaPresent`
  (résultat gardé entier) et `sauvegardeDonnees.requeteDeBase` (un CONSTRUCTEUR de requête, pas un
  résultat). **Il y en avait CINQ, et la cinquième raison était fausse** : `DossierDetail`, dispensé
  parce que « l'écran garde ses SQUELETTES, il n'affirme rien ». Vrai de l'en-tête, et de lui seul —
  ses ONGLETS recevaient cette identité vide en props et l'écrivaient (voir « la barre latérale a
  rouvert une course », 25/09/2026). La dispense est retirée, la lecture prend son erreur.
  **ET L'EXCEPTION PORTE DÉSORMAIS UN NOMBRE, pas seulement une raison** — la leçon de
  `datesUtc.test.ts` reprise ici parce qu'elle était devenue nécessaire : les fichiers dispensés
  portent AUSSI des lectures correctes, et deux d'entre eux ont gagné une lecture en faute le jour
  même. Une de plus est une rechute, une de moins est une raison morte. **Et le compte a mordu tout
  de suite** : j'avais inscrit `sauvegardeDonnees` en exception, le garde l'a refusée puisque le
  scanner ne la voit pas du tout — donc rien n'y était dispensé.
  **CE QUI RESTE INVISIBLE EST DIT PLUTÔT QUE LAISSÉ CROIRE** : une requête CONSTRUITE d'un côté et
  attendue de l'autre (`const requete = requeteDeBase(table)` … `await requete.range(…)`) n'a plus
  l'ancre `supabase` sur le site qui attend. Une seule dans le dépôt, et son site d'attente lit bien
  son erreur — vérifié en l'ouvrant, pas en la comptant.
  **LA PORTE 2 A TROUVÉ UNE CINQUIÈME LECTURE DANS `AuthContext`** que la porte 1 ne pouvait pas
  voir : `supabase.auth.getSession().then(({ data }) => …)`. Elle est exemptée pour la même raison
  que `getUser` — sans réponse on n'est pas connecté, donc du côté FERMÉ — et l'exemption reste
  NOMMÉE, jamais `.auth.` en entier : `auth.admin.*` écrit des comptes, et c'est là qu'un mot de
  passe jamais posé s'est caché derrière un « ok ». Un cas synthétique garde cette frontière sur
  chaque porte.
  **LATENTS, et mesuré** : 0 facture en brouillon (donc `FactureFormModal` ne s'ouvre même pas
  aujourd'hui), 0 prévisionnel, 0 exercice clôturé ; 6 factures validées, 3 informations de dossier
  et 4 dossiers, eux, rendent les quatre autres producibles dès maintenant. Comme toute cette
  famille, ce qui les rend dignes d'être corrigés n'est pas un préjudice constaté mais qu'aucun ne
  PEUT se voir une fois arrivé.
  **Neuf mutations, toutes mordent**, et la répartition est le résultat : les deux défauts d'origine
  replantés font tomber À LA FOIS le scanner et le test d'écran — donc la FORME et le CÂBLAGE sont
  gardés séparément, là où une seule assertion aurait laissé croire que l'un couvre l'autre. Les
  sept autres visent le scanner lui-même : chaque porte rendue aveugle (une mutation par porte), les
  accolades appariées ramenées à `[^}]*` (**sixième fois** que ce dépôt se ferait prendre par la
  portée d'une expression régulière — ici sur une destructuration imbriquée, donc une faute INVENTÉE
  sur du code correct), le corps de la porte 2 qui ne s'arrête plus au `supabase` suivant,
  l'exemption élargie à `.auth.`, le compte d'une exception menti d'une unité, et l'exception
  INVENTÉE.
  **ET LE TEST D'ÉCRAN QUE JE VENAIS D'ÉCRIRE ÉTAIT LUI-MÊME INSTABLE — une fois sur trois** :
  il s'ancrait sur un TITRE, présent dès le premier rendu, donc avant que `load()` ait résolu son
  `Promise.all`. C'est la pire forme d'échec, assez rare pour passer pour du bruit de CI. Il attend
  désormais la fin du chargement par le seul signal que l'écran en donne — la tuile « Trésorerie
  actuelle », qui affiche « — » tant que `loading` est vrai. Trouvé en rejouant `test:fuseaux`
  plutôt qu'en le relisant, et vérifié par huit passages complets sur quatre fuseaux.
- **ET CE BALAYAGE-LÀ S'ÉTAIT ARRÊTÉ À `src/` — LES LECTURES DES EDGE FUNCTIONS N'AVAIENT JAMAIS ÉTÉ
  REGARDÉES** (22/09/2026, le lendemain). C'est mot pour mot ce qui était arrivé aux ÉCRITURES le
  21/09 (« ET CE BALAYAGE S'ÉTAIT ARRÊTÉ À `src/` »), sur l'autre sens de la même règle : les
  écritures avaient alors été portées ici par `edgeFunctionsEcritures.test.ts`, les LECTURES non.
  **Et la raison qui rend ce côté plus coûteux est LA MÊME** : dans `src/`, la question qui décide
  est *quelque chose recharge-t-il derrière ?*, et la réponse y est presque toujours oui. Dans une
  Edge Function elle est presque toujours non — rien ne recharge, l'appelant reçoit le code de
  retour que la fonction a décidé d'écrire, et une lecture refusée y produit une AFFIRMATION que
  personne ne peut démentir.
  **Mesuré : 28 lectures nues, 8 en faute**, et les trois qui coûtent le plus sont des bonnes
  nouvelles fabriquées — le pire sens de cette famille.
  - **LE PLAFOND DE COÛT IA SE LEVAIT TOUT SEUL, PAR N'IMPORTE LAQUELLE DE SES TROIS LECTURES.**
    `verifierPlafondCabinet` échouait du côté OUVERT à chaque fois : sans réponse, les deux seuils
    sont nuls (« pas de plafond, on évite même la requête suivante »), la liste des dossiers est vide
    (« 0,00 $ »), l'usage du mois vaut zéro. Une lecture refusée rendait donc `bloque: false` en
    annonçant 0,00 $ consommé, sur le SEUL mécanisme qui borne une dépense — et ce fichier désignait
    déjà `agent_conversations` comme la table dont la troncature « ne vide pas le compteur de coût
    IA, elle le SOUS-ESTIME, ce qui est la façon exacte dont un plafond cesse de protéger ». Une
    lecture refusée, elle, le met à ZÉRO : la même phrase en pire.
    **On refuse la question plutôt que de la laisser passer**, et c'est le précédent `PresenceTexteOcr` :
    **ne pas savoir interdit d'engager une dépense**. Un refus coûte une question, une lecture
    refusée coûte un mois de plafond. Le message NOMME sa cause — « plafond atteint » et « plafond
    invérifiable » appellent deux gestes opposés (attendre le mois prochain, ou réessayer).
  - **`superpdp-sync` réimportait toute la page en un clic.** La liste des factures DÉJÀ importées,
    vide sur une lecture refusée, faisait passer `aTraiter` de « les nouvelles » à « toutes » :
    jusqu'à `MAX_FACTURES_PAR_SYNC` pièces en double venues d'une plateforme agréée DGFiP, donc
    autant de charges comptées deux fois — sous une réponse « N importées » qui est vraie.
  - **`receive-email` — TROISIÈME COPIE de `fichierDejaPresent`**, celle dont ce fichier dit qu'elle
    lève précisément parce qu'« un `count` nul est indiscernable d'un aucun doublon trouvé ». Le
    commentaire juste au-dessus promettait « la même détection que les autres points d'entrée ». On
    SAUTE la pièce jointe plutôt que de la déposer : un doublon est permanent et compte la charge
    deux fois, quand une pièce jointe non déposée laisse la trace de tout échec de cette fonction —
    et le dossier continue de la réclamer sur les trois écrans « ce qu'il reste à envoyer ». Le
    jumeau de `src/` LÈVE ; ici il n'y a aucun opérateur pour recevoir une exception.
  - **`send-email` envoyait au client une facture SANS AUCUNE LIGNE**, au bon en-tête et au bon
    total — `(lignesData ?? [])` sur une lecture refusée. Sa jumelle SIX LIGNES plus haut lit son
    erreur. Un e-mail parti ne se rattrape pas.
  - Plus **`lister_pieces`** de l'assistant (toutes les pièces rendues `categorie: null`, en français
    à un comptable qui n'ira pas vérifier) et le **statut Super PDP** (`configured: false` invite à
    ressaisir un `client_secret` par-dessus celui qui existe).
  **DIX-NEUF LECTURES NUES RESTENT, TOUTES LÉGITIMES — résultat à garder pour ne pas les
  réenquêter** : ce sont les contrôles d'accès (`admin_du_dossier`, `cabinet_admins`, `super_admins`,
  `memberships`) et les refus qu'ils commandent. Sans réponse, rien n'est accordé — le côté FERMÉ.
  `appartientDejaAuCabinet` est le cas le plus net : son échec rend « ce compte n'appartient pas à ce
  cabinet », et son propre commentaire dit pourquoi ce sens-là est le bon (c'est la garde contre la
  prise de contrôle d'un compte déjà inscrit ailleurs).
  **`edgeFunctionsLectures.test.ts` fait de la règle un contrôle**, sibling d'`edgeFunctionsEcritures`.
  Deux portes (`await <client>.<porte>` destructuré, et l'entrée d'un `Promise.all`), **le client
  n'est PAS nommé** (`admin`, `supabase`, `supabaseAsCaller` selon les fonctions — ancrer sur un nom
  serait la liste d'inclusion, encore), l'exemption de session reste NOMMÉE (`getUser`/`getSession`,
  jamais `.auth.` en entier), et **l'exception porte un NOMBRE** : quatre de ces neuf fonctions
  portaient le même jour une lecture légitime ET une lecture en faute, donc une dispense par nom de
  fichier les aurait couvertes toutes les deux.
  **ONZE MUTATIONS, TOUTES MORDENT** — dont les quatre défauts d'origine replantés, chaque porte
  rendue aveugle séparément, l'ancrage sur un seul nom de client, l'exemption élargie, le compte
  menti d'une unité et l'exception inventée.
  **ET LA MUTATION DES ACCOLADES APPARIÉES A SURVÉCU D'ABORD** : mon cas de destructuration
  imbriquée était sur la porte `await`, qui apparie ses accolades elle-même — `groupeAccolades` ne
  sert QU'À la porte `Promise.all`. Une mutation qui ne mord pas accuse d'abord le jeu d'essai ;
  déplacé sur la bonne porte, elle mord.
  **LES CINQ FONCTIONS SONT EN PRODUCTION** le jour même : `superpdp-credentials` v4, `superpdp-sync`
  v5, `send-email` v4, `receive-email` v7, `agent-comptable` v20 — chacune avec son `verify_jwt` relu
  et repassé à `false`, le déployé comparé au dépôt AVANT écrasement (identique à HEAD les cinq fois,
  donc personne n'avait modifié la production à la main et il n'y avait aucun correctif non déployé à
  embarquer), et un aller-retour après : **zéro différence résiduelle sur 110, 264, 236, 292 et
  740 lignes**.
- **ET LE SCANNER DES ÉCRITURES, LUI, NE VOYAIT QU'UNE FORME SUR SIX — ET C'ÉTAIT MON TRAVAIL DE LA
  VEILLE** (22/09/2026). Le matin même, `lecturesVerifiees` avait gagné deux portes de FORME parce
  qu'« une lecture s'écrit aussi SANS `await` » ; l'après-midi, `edgeFunctionsLectures` était écrit
  avec ces portes dès le départ. **Son frère `edgeFunctionsEcritures` est resté sur sa lecture LIGNE
  PAR LIGNE**, ancrée sur `^\s*await <client>.<porte>` — donc sur une seule ligne. C'est mot pour
  mot « le balayage s'était arrêté à mi-chemin », commis dans la session qui venait de le corriger
  deux fois.
  **MESURÉ PAR MUTATION, jamais supposé** : retirer la destructuration de la compensation qui répare
  un cabinet à moitié créé — `const { error: insertError } = await admin` / `.from("cabinet_admins")`
  / `.insert({…})`, une VRAIE écriture du dépôt — laissait **les douze tests au VERT**. Cinq formes
  sur six étaient aveugles : chaîne multi-ligne, entrée de `Promise.all`, `.then(`, promesse
  flottante, `void`. Et la multi-ligne n'a rien de théorique — **six écritures de ces fonctions sont
  écrites ainsi**, c'est le formatage normal du dépôt. **SEPTIÈME fois que ce dépôt se fait prendre
  par un retour à la ligne.**
  **AUCUNE FAUTE VIVANTE DERRIÈRE CE TROU, et c'est dit plutôt que gonflé** : les trente-deux
  écritures de ces fonctions prennent toutes leur résultat aujourd'hui. Ce qui justifie
  l'élargissement n'est donc pas une prise mais la mutation ci-dessus — contrairement aux six autres
  scanners de ce dépôt, celui-ci est refermé sur un trou démontré et non sur un défaut trouvé, et la
  différence mérite d'être écrite.
  **LA RÉPARATION CHANGE LA QUESTION POSÉE** : on ne cherche plus une forme d'écriture mais on
  demande, à la TÊTE de chaque chaîne, *quelqu'un prend-il ce résultat ?* Pris — destructuré,
  affecté, rendu, passé en argument, branche de ternaire — l'erreur reste atteignable, et c'est alors
  au scanner des LECTURES de vérifier qu'on la prend vraiment : deux tests, deux questions, aucune
  zone commune. Jeté, il n'existe aucune raison d'écrire cela contre une base. Une forme non prévue
  tombe du côté SIGNALÉ, jamais du côté silencieux.
  **ET LA MUTATION QUI A SURVÉCU ACCUSAIT LE SCANNER, pas le jeu d'essai — variante nouvelle de la
  règle**. La première version sautait tout maillon précédé d'un point, pour ne pas compter deux fois
  `supabase.storage.from(…)`. Retirer cette règle laissait **tout au vert** : le drapeau `g` consomme
  déjà le jeton `storage`, donc elle ne protégeait de RIEN — et elle rendait aveugle un client atteint
  par une propriété (`deps.admin.from(…)`), dans le seul sens dangereux. Remplacée par la remontée à
  la tête de chaîne, qui est correcte dans les deux sens, et gardée par les deux cas.
  **LES DEUX SCANNERS DE LECTURES ONT ÉTÉ VÉRIFIÉS PAR MUTATION RÉELLE, pas par relecture** — c'est
  exactement l'erreur qu'on vient de corriger : une lecture multi-ligne privée de son `error` est bien
  attrapée dans `superpdp-sync` (Edge) comme dans `informationsDossier.ts` (`src/`). Le trou était
  strictement du côté des écritures.
  **Dix mutations, toutes mordent** — dont le défaut d'origine TEL QU'IL ÉTAIT (`source.split('\n')`),
  l'écriture multi-ligne réelle, chaque porte rendue aveugle, le scanner qui crie au loup, la porte
  `Promise.all` retirée, les commentaires non coupés et l'exception INVENTÉE.
- **ET RECEVOIR LE DRAPEAU N'EST PAS LE LIRE : HUIT ÉCRANS PROMETTAIENT DE SIGNALER UNE LECTURE
  PARTIELLE ET NE TENAIENT LA PROMESSE QUE POUR UNE LECTURE SUR DEUX** (22/09/2026). Tout ce qui
  précède garantit qu'une lecture de collection est PAGINÉE et qu'elle REND `complete`. Rien ne
  garantissait qu'on le lise — et l'en-tête de `lireTout` promet pourtant que l'appelant « ne peut
  plus l'ignorer par omission ».
  **Mesuré : 110 sites d'appel, 52 dont le drapeau n'est lu nulle part.** Ils se coupent net en deux,
  et c'est la coupure qui décide du chantier : **23 sur huit écrans qui portent DÉJÀ un
  `BandeauLecturePartielle`** (ou refusent un export), donc qui ont déjà décidé de signaler ; 29 sur
  neuf écrans qui ne signalent rien du tout, ce qui ÉTAIT une autre question — tranchée dans la
  foulée, voir plus bas.
  **C'est mot pour mot le défaut de `ClotureTab`**, corrigé plus haut dans ce fichier — « en n'ayant
  vérifié QUE les pièces, soit une entrée sur cinq… le garde-fou promettait "ce formulaire est bâti
  sur tout" sans pouvoir le tenir ». Corrigé là, resté entier sur les huit voisins : `ChecklistTab`
  4 lues sur 9, `PiecesTab` 1 sur 6, `EstimationTab` 2 sur 7, `BanqueTab` 2 sur 4, `ClientHome` et
  `ClientUpload` 2 sur 4, `DocumentsTab` 1 sur 2, `EcrituresTab` 6 sur 7.
  **Un bandeau éteint n'est pas une information neutre : son silence se lit « tout a été lu ».**
  `ChecklistTab` est le cas le plus coûteux pour la raison que son propre commentaire énonce — « cet
  écran est précisément celui qui prétend dire ce qui MANQUE… la panne est indiscernable du succès ».
  Ses cinq lectures jetées commandent des points de la liste : `categoriesSansCompte` et
  `categoriesSansPoste` partent des CATÉGORIES, `ecrituresSansObjet` des IMMOBILISATIONS, le contrôle
  de TVA des DÉCLARATIONS. Une seule tronquée et le point correspondant se TAIT.
  **ET LE COMMENTAIRE DE `PiecesTab` NOMMAIT LE DÉGÂT AU-DESSUS DU CODE QUI JETAIT LE DRAPEAU
  PERMETTANT DE LE VOIR** — « tronquée, elle ne se signale pas : les règles absentes cessent
  simplement de s'appliquer, et l'opérateur recatégorise à la main un fournisseur qu'il a déjà
  arbitré dix fois ». Famille déjà nommée trois fois ici (`chargerCommentaires`, `formatDate`,
  la confirmation de clôture), et c'est la quatrième.
  **LA CONSÉQUENCE LA PLUS DURE N'EST PAS UN AFFICHAGE, C'EST UNE ÉCRITURE** : les règles
  « toujours ignorer » de `BanqueTab` décident du `statut` ÉCRIT EN BASE à l'import d'un relevé
  (`statutPourLibelle`, deux sites). Une liste tronquée n'affiche donc pas de travers — elle importe
  des mouvements « à traiter » qu'une règle couvre, et **aucun rechargement ne le répare ensuite**.
  C'est le seul des 23 dont le dégât survive à la lecture suivante.
  **LES CONSÉQUENCES NE SE FONDENT PAS**, et trois bandeaux ont donc été ajoutés plutôt qu'un
  drapeau élargi : sur `BanqueTab` (cotisations et règles — « un mouvement reste à traiter alors
  qu'une règle le couvre »), sur `PiecesTab` et `DocumentsTab` (listes de référence — `sousDossierLabel`
  rend « — » pour un sous-dossier absent, et cette colonne part dans l'export CSV). Et
  `lectureDeclarations` a son propre drapeau dans `EcrituresTab` PLUTÔT QUE `brouillonIncomplet` :
  celui-là BLOQUE les exports FEC et piste d'audit, or une lecture tronquée des déclarations de TVA
  n'a aucune raison d'empêcher un FEC juste.
  **MON PROPRE DÉTECTEUR A MENTI TROIS FOIS AVANT DE MESURER JUSTE, et les trois sont des rechutes
  connues de ce dépôt :** il lisait « la ligne » et non l'EXPRESSION (une entrée de `Promise.all`
  s'écrit sans `await`) ; il découpait les entrées sur la virgule SANS retirer les commentaires, or
  les tableaux `Promise.all` d'ici en portent de longs, à virgules — l'appariement entrée ↔ nom
  glissait d'un cran ; et surtout **il ne cherchait que `complete` alors que quatre écrans corrects
  lisent `motif`**, qui vaut `null` SI ET SEULEMENT SI `complete` est vrai. Il rendait alors 86
  fautes sur 110, dont l'essentiel était faux. Un taux qui accuse d'abord le détecteur.
  **`lecturesSignalees.test.ts` fait de la règle un contrôle, et son invariant s'est RESSERRÉ dans la
  même session.** Il a d'abord été posé en « TOUTES OU AUCUNE » — un écran qui signale les signale
  toutes — parce que neuf écrans ne signalaient RIEN, et que leur en donner un est une décision par
  écran (que dit-on au client ? faut-il bloquer un export ?) et non une correction : un scanner qui
  aurait crié sur leurs 29 lectures aurait été du bruit. **Les neuf ont été couverts dans la foulée**,
  donc la borne faible n'avait plus de raison d'être — les 110 sites du dépôt lisent désormais leur
  drapeau, et TOUTE lecture qui le jetterait est une faute. La version faible est écrite dans le test
  plutôt qu'effacée : c'est elle qui permet de reprendre ce contrôle sur un dépôt dont le portage
  n'est pas fini, sans le rendre inécoutable. Le PLANCHER a changé de nature avec l'invariant — il ne
  compte plus les fichiers qui signalent mais les LIAISONS que le scanner voit encore (110), sans
  quoi « aucune lecture jetée » serait aussi ce que rend un scanner devenu aveugle.
  **CE QUE DISENT LES NEUF NOUVEAUX BANDEAUX, et pourquoi la conséquence n'est jamais la même** :
  `FinancementTab` (6 lectures) parle du document qu'on présente à une BANQUE — trésorerie,
  échéancier des dettes, ratios, prévisionnel ; `SuperAdminPage` (5) dit qu'un coût IA tronqué est
  SOUS-ESTIMÉ, « la façon exacte dont un plafond cesse de protéger » — l'autre moitié de ce même
  nombre ayant été corrigée le matin dans `agent-comptable` ; `SupplementsTab` (4) dit qu'un solde de
  compte courant tronqué « n'est pas plus court, il est FAUX », ce solde étant toujours recalculé
  depuis l'historique complet ; `FacturesTab` (1) qu'une suite de numéros LÉGALE tronquée « fait
  croire à un trou là où il n'y en a pas » ; `AssistantTab` (1) que le fil repris perd ses premiers
  échanges, donc le contexte même que l'assistant relit. Plus `ClientSimulation` (4, dans le registre
  du client, `technique={false}`), `ImmobilisationsTab` (3), `EquipePage` (3) et `CotisationsTab` (2).
  **ET TROIS COMMENTAIRES DE PLUS NOMMAIENT DÉJÀ LEUR DÉGÂT** au-dessus d'un code qui jetait le
  drapeau — `SupplementsTab` (« une lecture tronquée donnerait un solde faux, pas un historique plus
  court »), `AssistantTab` et `FacturesTab`. Avec `PiecesTab`, cela fait QUATRE dans ce seul chantier.
  C'est la forme la plus fréquente du défaut dans ce dépôt, et elle se cherche en lisant les
  COMMENTAIRES plutôt que le code : là où quelqu'un a pris la peine d'écrire ce qui serait perdu, il
  y a une bonne chance que rien ne le garde.
  **VINGT-DEUX MUTATIONS SUR LES DEUX TEMPS, VINGT-ET-UNE MORDENT**, et la discrimination est le
  résultat : le défaut d'origine replanté fait tomber À LA FOIS le scanner et le test d'écran — donc
  la FORME et le CÂBLAGE sont gardés séparément —, et « un écran cesse ENTIÈREMENT de signaler »
  passait sous l'invariant faible alors qu'il mord sous le resserré, ce qui est exactement ce que le
  resserrement devait acheter.
  **ET UNE TROISIÈME COUCHE EXISTAIT SANS QUE JE L'AIE MESURÉE : LE COMPILATEUR.** Il était écrit ici
  qu'un scanner de source ne peut pas voir un rendu et que seul le test d'écran couvre ce cas — vrai
  du scanner, et incomplet. `noUnusedLocals: true` est actif dans les deux `tsconfig`, donc un drapeau
  posé, calculé, et qui n'atteint PLUS RIEN fait échouer `tsc -b` en
  « `'lectureIncomplete' is declared but its value is never read` ». Vérifié en posant la mutation,
  pas en relisant le réglage. **Les trois couches ne se recouvrent donc pas** : le scanner voit qu'on
  CALCULE le drapeau, le compilateur qu'on le LIT, le test d'écran qu'il ATTEINT l'opérateur — et
  seul le dernier attrape un bandeau bien rendu sous une condition qui ne se réalise jamais.
  **La dernière mutation survit à juste titre, et c'est écrit dans le test** : retirer la virgule de
  queue du découpage ne change rien, une entrée vide n'apparaissant qu'en FIN de liste, donc ne
  décalant jamais un indice antérieur. Ce qui garde réellement l'appariement est la mutation qui
  décale `noms[k]` d'un cran, et celle-là mord.
- **ET CE SCANNER NE LISAIT QUE TROIS FORMES D'ÉCRITURE — HUIT APPELS SUR 118 LUI ÉCHAPPAIENT, ET UN
  NOM LU DANS LA FONCTION VOISINE EN MASQUAIT UN AUTRE** (25/09/2026). `lecturesSignalees` liait
  `const X = await lireTout(…)`, sa forme déstructurée et l'entrée d'un
  `const [...] = await Promise.all([…])`. Or **huit appels** s'écrivaient `lireTout(…).then((lecture) => …)`
  ou `Promise.all([…]).then(([a, b]) => …)` : ni comptés, ni vérifiés. **Cinq jetaient leur drapeau** —
  les TROIS lectures qui font la liste des exercices d'un dossier, sous un commentaire qui décrivait
  déjà le dégât (« elles font disparaître un EXERCICE du sélecteur, et tout ce que le cabinet regarde
  ensuite est filtré par lui ») ; les relevés déjà classés que l'import bancaire propose de
  réutiliser ; les catégories de la Balance des comptes, que `brouillon.motif ?? lecturePieces.motif`
  oubliait dans le même `Promise.all`. **Le « 110 sites » de l'entrée ci-dessus était vrai des formes
  connues, pas du dépôt** — le silence d'un scanner qui ne voit pas ressemble exactement à un dépôt
  sain, et c'est la huitième fois que ce dépôt le paie.
  **LE RECENSEMENT FAIT DÉSORMAIS FOI** : le scanner part de TOUS les appels de `lireTout` (sa
  définition exclue — elle vit à trois endroits) et compte en FAUTE tout appel qu'aucune forme ne lie.
  La prochaine forme d'écriture se signalera d'elle-même au lieu de passer en silence — la règle
  « une table non reconnue est une faute, jamais un saut » de `triTotal`, appliquée ici.
  **ET LA MESURE EN A TROUVÉ UN SIXIÈME, QUE LA PREMIÈRE CORRECTION NE VOYAIT PAS** : le scanner jugeait
  un nom « couvert » s'il était lu N'IMPORTE OÙ dans le fichier. `PacksTab` déclare
  `const lecture = await lireTout(…)` dans DEUX fonctions, et seul l'aperçu lit son drapeau :
  l'historique des packs jetait le sien depuis le portage, sous un nom couvert par sa voisine.
  Tronqué, il cache un pack déjà généré — donc peut-être déjà envoyé — et invite à le régénérer : les
  mêmes pièces partiraient deux fois au comptable. Refusé, il affirmait « Aucun pack généré », le
  pire sens. Le drapeau doit donc être lu dans le BLOC de la déclaration, ou dans le RAPPEL pour les
  formes `.then` : dans `BanqueTab`, `lecture.complete` est lu par la lecture des mouvements et pas
  par celle des relevés, et un contrôle à l'échelle du fichier l'aurait laissée passer.
  **Six lectures signalées, quatre bandeaux, chacun avec SA conséquence** : les exercices (un
  exercice absent du sélecteur n'est pas forcément vide), les relevés (un relevé peut manquer à la
  liste sans être absent de Documents), les catégories (un compte peut s'afficher sans libellé, mais
  AUCUN montant n'en dépend — le bandeau des totaux reste donc éteint, et une mutation qui les fond
  est attrapée), les packs (ne pas en régénérer un sans vérifier qu'il n'est pas déjà parti).
  **ET LE BANDEAU LUI-MÊME FAISAIT DES FAUTES D'ACCORD** : il écrivait « n'ont pas pu être lues »
  quel que soit le sujet — « L'historique des échanges n'ont pas pu être lues », « Les mouvements
  bancaires … lues ». Il prend désormais un `accord` explicite (`lues` par défaut, la forme d'avant) :
  le deviner d'un nom français serait un pari, et une faute dans une alerte la fait passer pour une
  négligence. Les deux nouveaux bandeaux masculins l'utilisent dès leur création, et les NEUF anciens
  dont le sujet est masculin ou au singulier sont corrigés dans la foulée — un test d'écran figeait
  même la faute, en attendant « L'historique des échanges n'ont pas pu être lues ». **Rien ne vérifie
  l'accord à part la relecture**, et c'est dit plutôt que promis : le genre d'un nom ne se déduit pas
  de son texte, et un contrôle sur le seul nombre (« La … » donc singulier) raterait « L'historique ».
  **Seize mutations, toutes mordent** : chaque forme `.then` retirée, l'appel non lié sauté (seul le
  cas synthétique le voit, puisque sur le dépôt corrigé tous les appels sont liés), le rappel puis la
  déclaration jugés à l'échelle du fichier, la définition prise pour un appel, le recensement aveugle
  (le plancher passe de 110 à 118), chaque bandeau retiré, le bandeau des packs toujours allumé,
  « Aucun pack » affirmé sur une panne, les catégories fondues dans les totaux, l'accord ignoré et
  l'auxiliaire toujours au pluriel.
- **ET LE PLAFOND DE COÛT IA SE SOUS-ESTIMAIT — `lecturesPaginees` S'ÉTAIT ARRÊTÉ À `src/` LUI AUSSI**
  (22/09/2026, QUATRIÈME demi-chemin en deux jours : les écritures des Edge Functions portées le
  21/09, leurs lectures le 22/09 au matin, la FORME de leur scanner d'écritures à midi — et la
  PAGINATION, jamais).
  **Mesuré : 16 lectures de collection non bornées dans les Edge Functions, 12 en faute.**
  - **LE PLAFOND DE COÛT IA, par ses DEUX lectures** (`dossiers` du cabinet, puis `agent_conversations`
    du mois) — des `select` nus. Tronquées, elles ne vident pas le compteur, elles le **SOUS-ESTIMENT**,
    en retirant ce qui tombe au-delà de la coupure. **Et le commentaire posé LA VEILLE juste sous cette
    lecture CITE cette phrase de CLAUDE.md** (« la façon exacte dont un plafond cesse de protéger »),
    au-dessus d'un code qui ne la tenait pas : la famille « une mise en garde écrite au-dessus d'un code
    qui ne la tient pas », quatrième occurrence, fabriquée dans la session qui l'avait nommée.
    `agent_conversations` est **la table qui grandit le plus vite du projet** — une ligne par message —
    donc la première à franchir le plafond de PostgREST.
  - **`superpdp-sync`** — la liste des factures DÉJÀ importées. VIDE, elle faisait réimporter toute la
    page (corrigé le matin même) ; **TRONQUÉE, elle fait exactement pareil** pour tout ce qui dépasse
    la coupure. Même raisonnement que `chargerHashsExistants`, qui LÈVE pour cette raison précise.
  - **Les quatre outils de l'assistant** (`resume_dossier`, `lister_comptes`, `points_a_traiter`, les
    catégories de `lister_pieces`). **« Une liste plafonnée dit qu'elle l'est » ne les couvre PAS** :
    cette règle vise les listes RENDUES au modèle, qui portent déjà leur drapeau `tronque`. Ici les
    lignes alimentent des COMPTEURS — un total par compte, un nombre d'anomalies — et un compteur
    tronqué n'est pas une liste plus courte, c'est un **CHIFFRE FAUX** annoncé en français à un
    comptable qui n'ira pas vérifier. `points_a_traiter` répondrait « rien à signaler » sur un dossier
    portant une anomalie au-delà de la coupure.
  **QUATRE LECTURES RESTENT NON BORNÉES, ET C'EST LÉGITIME — résultat à garder** : les lignes d'UNE
  facture (`send-email`, `superpdp-emit`), bornées par le modèle ; et les `dossiers` du cabinet dans
  `appartientDejaAuCabinet` (deux copies), dont la troncature fait REFUSER en 409 — le côté FERMÉ.
  **LATENT, et mesuré** : 2 lignes d'`agent_conversations`, 4 dossiers, 78 pièces, 3 écritures,
  10 catégories. Le critère du projet ne regarde pas le nombre de lignes d'aujourd'hui mais « cette
  collection peut-elle grandir ? ».
  **`lireTout` est DUPLIQUÉ dans les deux fonctions** (auto-portées), donc gardé comme les autres
  copies : `edgeFunctionsPaginees.test.ts` EXTRAIT la boucle entre ses bornes `── DÉBUT/FIN
  PAGINATION`, la **transpile avec le compilateur du projet** (le bloc est du TypeScript — un retrait
  de types écrit à la main mentirait au premier cas tordu) et l'EXÉCUTE contre six faux serveurs.
  **ET LA MUTATION DE LA TAUTOLOGIE SURVIT SEULE, CE QUI EST LE RÉSULTAT** : comparer la copie à
  elle-même laisse les 23 tests verts — évidemment — mais la même tautologie PLUS une vraie dérive
  plantée dans la copie déployée (avancer de la taille demandée au lieu du rendu) les laisse verts
  AUSSI, alors que la dérive seule en fait tomber un. C'est l'aveuglement d'`agentComptableAnalyse`
  démontré plutôt qu'affirmé, et c'est pourquoi la référence est celle de `src/lib`, extérieure aux
  deux copies.
  **Douze mutations, onze mordent** — les trois défauts d'origine replantés (les deux du plafond, celle
  de `superpdp-sync`), le scanner aveugle, le scanner qui crie au loup, la borne au `.from(` suivant,
  l'exception INVENTÉE, les commentaires non coupés, la copie déployée qui avance de la taille
  demandée, celle qui se déclare complète sans compte annoncé, et une SECONDE définition de `lireTout`
  dans la même fonction.
  **LES DEUX FONCTIONS SONT EN PRODUCTION** le jour même : `superpdp-sync` v6 et `agent-comptable`
  v22, chacune avec son `verify_jwt` relu et repassé à `false`, le déployé comparé au dépôt AVANT
  écrasement (identique à HEAD les deux fois, donc personne n'avait modifié la production à la main),
  et un aller-retour après : zéro différence résiduelle sur 323 et 828 lignes.
  **ET L'ALLER-RETOUR A MORDU POUR LA PREMIÈRE FOIS SUR UNE VRAIE FAUTE DE TRANSCRIPTION** — c'est à
  garder, parce que jusqu'ici il n'avait jamais rendu autre chose que « zéro différence » et qu'on
  aurait pu finir par le croire décoratif. La première version d'`agent-comptable` v21 portait deux
  `regénérer` au lieu de `régénérer`, dans un commentaire ET **dans la description d'un outil, que le
  modèle lit à chaque appel**. Inoffensif au sens du comportement ; mais une différence connue entre
  le déployé et le dépôt est précisément ce qui fait mentir l'audit suivant — la famille du
  « REGISTRE » déjà nommée pour `bright-task`. Redéployé en v22, différence ramenée à zéro.
  **Et le résultat d'un `get_edge_function` de cette taille est écrit SUR DISQUE** par l'environnement,
  chemin donné dans le message : c'est le chemin bon marché que CLAUDE.md décrit, et il rend
  l'aller-retour d'une fonction de 828 lignes aussi simple que celui d'une petite.
- **ET LE TROISIÈME JEU D'ESSAI D'ÉCRAN N'ÉTAIT PAS TYPÉ — cinq colonnes manquantes** (21/09/2026).
  Le remède de la contrainte de type avait été appliqué à `ChecklistTab` et `BanqueTab`, pas à
  `PiecesTab`, dont le `piece()` restait un `Record<string, unknown>`. Typé `Partial<Piece> => Piece`
  **sans `as`**, le compilateur a sorti une par une : `uploaded_by`, `source`, `conversion_source`,
  `notes`, `superpdp_invoice_id`. Aucune n'était visible en relisant, et aucune ne faisait échouer
  un test — c'est le propre de ce défaut : il ne se voit qu'en posant l'assertion qui tombe dessus,
  et ici l'assertion est le compilateur. **S'arrêter à deux écrans sur trois** est la même
  demi-mesure que le scanner qui ne regardait qu'une porte sur quatre.
- **UN DÉPLOIEMENT N'EST PAS UN COMMIT NON PLUS — une fonction vit en production sans exister dans ce
  dépôt** (constaté le 21/09/2026). `list_edge_functions` rend **quatorze** fonctions ; le dépôt en
  porte treize. La quatorzième s'appelle `bright-task` (nom par défaut de Supabase), elle est
  ACTIVE, en `verify_jwt: false`, et son nom n'apparaît dans AUCUN fichier du dépôt — ni source, ni
  doc, ni SQL.
  **Elle est inoffensive, et c'est une session précédente qui l'a rendue telle** : sa source déployée
  ne contient plus qu'un `Deno.serve(() => new Response("Fonction retirée — voir receive-email.",
  { status: 410 }))`. C'était une ancienne version de `receive-email`, restée active par erreur,
  neutralisée sur place faute d'outil de suppression.
  **Ce qui reste un défaut est donc le REGISTRE, pas la fonction** : la décision n'existe QUE dans la
  copie déployée. Un audit qui part du dépôt ne peut pas la connaître, et rouvre l'enquête — c'est
  précisément ce qui s'est passé ici, au coût d'une lecture de source et d'une vérification Resend.
  **La vérification a été REFAITE plutôt que recopiée** (21/09/2026, MCP Resend) : un seul webhook
  enregistré, `email.received` → `.../functions/v1/receive-email`. `bright-task` ne reçoit donc rien.
  **À ne pas réenquêter au prochain audit** ; à supprimer le jour où un outil le permet.
- **ET DÉPLOYER PAR L'OUTIL MCP REMET `verify_jwt` À `true` SI ON NE LE DIT PAS — trouvé en me le
  faisant à moi-même, le 21/09/2026.** `deploy_edge_function` porte un paramètre `verify_jwt`
  **obligatoire, dont le défaut est `true`**. Omis, il ne prend pas la valeur en place : il la
  REMPLACE. `create-cabinet` est ainsi passée de `false` à `true` en version 2, sans que rien dans
  l'appel ne parle d'authentification. Restauré en version 3 — et les deux versions portent le même
  `ezbr_sha256`, ce qui prouve que seul le drapeau avait bougé, le code étant identique au caractère
  près.
  **CE QUE ÇA COÛTERAIT SUR LA MAUVAISE FONCTION** : `receive-email` est le webhook Resend, appelé
  par un tiers qui ne porte AUCUN JWT. La passer à `true` ferait rejeter chaque e-mail entrant par la
  passerelle, **avant même que la fonction tourne** — donc sans un seul log applicatif, sans erreur
  dans l'application, et avec pour seul symptôme des e-mails clients qui n'arrivent plus. C'est
  exactement la forme de panne que ce fichier traque partout : celle qui ressemble au silence normal.
  **DIX des quatorze fonctions déployées portent `verify_jwt: false`** (mesuré le 21/09/2026) :
  `receive-email`, `agent-comptable`, `create-cabinet`, `create-client-access`, `create-team-member`,
  `delete-cabinet`, `send-email`, `superpdp-credentials`, `superpdp-sync`, et `bright-task`. Les
  quatre autres sont à `true` (`extract-piece`, `superpdp-emit`, `taux-change-bce`,
  `evaluer-extraction`).
  **RÈGLE : tout appel à `deploy_edge_function` passe `verify_jwt` EXPLICITEMENT**, à la valeur que
  `list_edge_functions` rend pour cette fonction — jamais au jugé, jamais par omission. Le relire
  AVANT de déployer fait désormais partie de la comparaison déployé/dépôt, au même titre que la
  source : un déploiement ne change pas que du code.
- **UN EXPORT DE SCHÉMA N'EST PAS UN SCHÉMA — DOUZE TABLES N'Y EXISTAIENT PAS** (22/09/2026,
  quatrième membre de la famille « un commit n'est pas un déploiement »). `supabase/schema/` porte un
  export de l'historique de migrations, et PLAN_DE_REPRISE.md en tirait la promesse qu'un schéma
  reste reconstructible si le projet Supabase disparaît. **Mesuré : l'historique ne porte que 30
  `create table` pour 41 tables.** Douze ont été créées hors `apply_migration` (éditeur SQL,
  `execute_sql`) et n'existaient dans AUCUN fichier — dont `lignes_bancaires`, la plus grosse table
  du projet, et `ecritures_brouillon`, le cœur comptable dont sortent le FEC et la balance.
  **ET LE CONTRÔLE DE DÉRIVE NE POUVAIT PAS LE VOIR.** L'empreinte agrégée compare les FICHIERS aux
  MIGRATIONS ; elle était verte, et elle l'est encore (58 = 58, `d2a7eaa33d6fef10480b2aa8ea540c09`
  des deux côtés). Elle ne dit rien de ce que les migrations RECONSTRUISENT. **Une vérification qui
  prouve une chose plus faible que celle qu'on lui prête** est la panne que ce dépôt connaît sous
  plusieurs noms ; celle-ci portait sur le plan de reprise, c'est-à-dire sur ce dont on ne s'aperçoit
  que le jour où il est trop tard. Les deux documents qui promettaient trop le disent maintenant.
  **`supabase/schema/socle/tables_sans_migration.sql`** comble le trou : tables, contraintes, index,
  RLS et policies, générés depuis `pg_catalog`. Dans un SOUS-DOSSIER pour rester hors de l'empreinte,
  qui ne balaie que `schema/*.sql` — ce n'est pas une migration et il ne s'applique pas tout seul.
  Le bloc RLS n'est pas décoratif : **une table restaurée sans RLS n'est pas « à sécuriser plus
  tard », elle est lisible par tout Internet muni de la clé publique**, et rien ne le signale.
  **RIEN N'Y EST REFORMATÉ, ET C'EST CE QUI LE REND VÉRIFIABLE** : chaque instruction est le rendu
  exact du catalogue, donc `supabase/essais/socle.py` + `socle.sql` comparent AU CARACTÈRE PRÈS —
  57 instructions, empreinte `49fc3d3c27c7229699191765fa68753d` des deux côtés. Une version
  « propre » écrite à la main serait sémantiquement équivalente et INVÉRIFIABLE, c'est-à-dire
  exactement le plan de reprise qu'on croit avoir. Le harnais mord sur un type de colonne changé, une
  policy retirée, un RLS retiré, et reste stable sur un changement d'ORDRE, qui est la propriété
  voulue. **À rejouer après toute migration touchant l'une des douze** : c'est le seul moment où ce
  fichier peut dériver, et sa dérive ne se voit nulle part ailleurs.
  **ET LA SOURCE DEVENUE EXHAUSTIVE PERMET ENFIN LE GARDE-FOU QUI MANQUAIT AU PLAN DE SAUVEGARDE.**
  Une table par dossier doit être inscrite à TROIS endroits de `sauvegarde.ts`, et rien ne le
  vérifiait : `exercices_clotures`, créée le matin même, n'était inscrite dans aucun — une sauvegarde
  omettait silencieusement les marques de clôture, et une restauration aurait fait redemander au
  client les documents d'un exercice bouclé. `sauvegardeTables.test.ts` part du schéma comme
  `rls.sql` part de `pg_class`, refuse les DEUX sens (une table du plan absente du schéma fait
  échouer une restauration au moment où plus rien ne peut être vérifié), et n'a **AUCUNE
  exception** : 41 = 41 = 41. Six mutations mordent, dont le socle retiré du balayage — le trou
  d'origine — et le scanner rendu aveugle.
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
  **ET LA DERNIÈRE DUPLICATION SANS GARDE AVAIT DÉJÀ DÉRIVÉ — `agent-comptable`, 21/09/2026.** Le
  balayage des six fonctions qu'elle duplique depuis `src/lib` (`ecritures.ts`, `controles.ts`) a
  rendu cinq copies identiques et une périmée : `analyserEcritures` ne comparait **qu'un champ sur
  quatre**, le TOTAL, pendant que `piecesDesynchronisees` en avait gagné trois de plus dans la même
  journée — le compte, la ventilation de la TVA, la date.
  **Ce que ça coûte est pire ici que partout ailleurs** : l'assistant répondait « aucune écriture à
  régénérer » là où la Checklist du MÊME dossier en comptait, sur l'outil dont toute la raison
  d'être est de répondre « quelles sont les anomalies ? ». Encore deux livrables et deux réponses,
  mais celui-ci parle en français à un comptable qui n'ira pas vérifier.
  **Et la dérive était STRUCTURELLE, pas un oubli de recopie** : l'ancienne copie filtrait bien les
  mêmes pièces mais **jetait le compte attendu**, ce qui rendait trois des quatre comparaisons
  impossibles à écrire. La forme partagée (`piecesAComptabiliser`, qui rend la pièce ET son compte)
  a dû être portée d'abord — c'est elle qui rend la parité atteignable, et pas seulement vraie
  aujourd'hui.
  **TROIS MUTATIONS ONT SURVÉCU AU PREMIER JEU DE TESTS, et les trois disaient la même chose** : le
  garde comparait `src/lib` à lui-même. Extraire la source déployée et l'exécuter ne suffit pas s'il
  reste un chemin où la copie n'est pas celle qu'on croit — d'où `expect(deployee.analyserEcritures)
  .not.toBe(analyserEcritures)`, qui refuse l'identité de référence, et deux dérives **plantées dans
  la vraie source déployée** (la comparaison de compte retirée, le filtre d'immobilisation retiré)
  plutôt qu'une source synthétique. Quatorze tests, six mutations mordent.
  **Le harnais est bâti pour qu'on puisse lui donner une source FAUSSE** : `sourceDeployee()` et
  `extraire(source)` sont séparés, là où les quatre gardes précédents fondaient les deux. Sans cette
  couture, « le scanner est aveugle » et « les deux copies sont d'accord » restent indiscernables —
  la panne que ce dépôt connaît sous cinq autres noms.
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
- **ET UNE RÉSERVE QUI RENVOIE À UN BANDEAU QUI NE LA PORTE PAS N'EST PAS DITE NON PLUS**
  (21/09/2026). `dotationPourAnnee` compte la dotation d'amortissement EN ENTIER dès l'année
  d'acquisition ; l'amortissement fiscal se calcule **prorata temporis** depuis la mise en service,
  et le reliquat se déduit une année de plus, au-delà de la durée. La simplification est ASSUMÉE et
  écrite dans `types.ts` — le modèle ne porte pas de date de mise en service, et l'arbitrage reste
  celui de l'expert-comptable.
  **Ce qui ne l'était pas, c'est le silence.** La réserve ne vivait que dans le commentaire
  d'en-tête d'`ImmobilisationsTab`, qui renvoyait à « voir le bandeau » — or le bandeau de cet écran
  est `BrouillonBanner`, le rappel générique affiché sur TOUS les écrans du projet, et il ne dit rien
  de la première annuité. Le commentaire nommait donc une mise en garde qui n'existait nulle part,
  pendant que l'écran affichait une colonne **« Dotation annuelle »** — qui a toutes les apparences
  d'une annuité calculée — et que Clôture la portait en case CH d'une 2035 **signée**.
  **Ce que ça coûte, chiffré** : 12 000 € amortis sur 5 ans, acquis le 1er juillet, ce sont 2 400 €
  déduits pour 1 200 € dus ; acquis le 31 décembre, 2 400 € pour 6,67 €. Le TOTAL sur la durée reste
  juste — c'est la répartition entre exercices qui ne l'est pas, et elle est chargée en tête.
  **Le remède est celui du pack** : `dotationsNonProratisees` (lib/declaration2035.ts) CALCULE
  l'écart, les deux écrans le montrent. Trois décisions :
  - **Rendue VIDE quand elle n'apprend rien** — un bien acquis le 1er janvier a bien une première
    annuité pleine. Même raison que `detailPiecesSansDate` : une mise en garde permanente cesse
    d'être lue, puis emporte ses voisines dans son discrédit.
  - **Seule l'année d'ACQUISITION est rendue**, et c'est un arbitrage écrit : les annuités
    intermédiaires sont justes des deux côtés, et la seule autre qui diffère est le reliquat APRÈS
    la durée — une déduction manquante, donc dans le sens prudent, que le modèle ne produit jamais
    et que la phrase nomme à la place.
  - **Sur l'ensemble d'AVANT la recherche**, et c'est la règle « une recherche filtre l'affichage,
    jamais un total » prise par son côté le plus coûteux : une recherche ne doit pas fabriquer une
    ALERTE (le piège de la Balance des comptes), mais elle doit encore moins en faire DISPARAÎTRE
    une — c'est fabriquer une bonne nouvelle, que personne n'ira vérifier (le piège de la liste des
    dossiers). Elle suit en revanche le filtre d'exercice, qui est un cadrage choisi et affiché.
  **Sept mutations sur le calcul, six sur les deux écrans**, dont le code tel qu'il était des deux
  côtés, les gardes symétriques « l'écran avertit TOUJOURS », et les deux sens du cadrage.
  La convention d'arrondi est celle des amortissements linéaires (30/360), et la date retenue est
  celle d'ACQUISITION faute de mise en service au modèle — quand les deux diffèrent l'acquisition
  précède, donc la fraction calculée est la plus généreuse des deux.
- **ET LA MÊME DOTATION COMPTAIT UNE ANNÉE ENTIÈRE SUR SIX MOIS — SUR L'ÉTAT QUI PART À LA BANQUE**
  (`situationIntermediaire`, 22/09/2026). L'écran porte en tête « Période du 1er janvier au <date
  choisie> », et sa ligne « Amortissements » valait douze mois de dotation quelle que soit cette
  date.
  **Mesuré, et le cas extrême n'est pas théorique** : au 31 janvier, un bien de 12 000 € sur 5 ans
  donne 2 400 € de charge contre 800 € de recettes — l'état affichait un **résultat NÉGATIF de
  1 600 €**, un déficit entièrement fabriqué par la convention, sur le document qu'un cabinet montre
  à une banque pour obtenir un prêt. Au 30 juin, 7 600 € au lieu de 8 800, soit 14 % de moins.
  **Et `dansLaDuree` ne comparait que des ANNÉES** : un matériel acquis le 15 décembre était amorti
  en entier sur une situation arrêtée au 30 juin. Ce n'est pas une approximation de prorata, c'est
  une charge pour un bien qui n'existe pas encore à la date de l'état.
  **CE N'EST PAS LA RÉSERVE CI-DESSUS, et la frontière est le point** : `RESERVE_PRORATA_TEMPORIS`
  porte sur la date de MISE EN SERVICE, absente du modèle, donc on SIGNALE sans corriger. Ici la
  longueur de la période est connue exactement et le document n'est pas signé : une charge rapportée
  à une période est ce que cette période veut dire, pas un arbitrage. La réserve, elle, reste
  entière — la fraction part du 1er janvier et non de l'acquisition.
  **L'ANNÉE CIVILE COMPLÈTE EST INCHANGÉE AU CENTIME** (360/360), ce qui laisse le PRÉVISIONNEL
  intact : il appelle la même fonction du 1er janvier au 31 décembre pour préremplir CA et charges
  de référence. C'est la garde symétrique du test, sans laquelle « rapporter à la période » serait
  satisfait par une fonction qui rabote toujours.
  **`ratiosBancaires` était juste et le reste**, mais pour une raison qu'il fallait figer :
  `resultat - posteAmortissements` est INVARIANT quand les deux se déplacent du même écart, donc la
  CAF ne bouge pas d'un centime. Son commentaire, lui, disait « déjà compté pour l'année entière » —
  vrai à l'époque, devenu faux sans qu'aucun signal ne paraisse, exactement « une contrainte
  justifiée par un appelant ». Un test porte désormais l'invariance à la place de la phrase.
  **LATENT, et mesuré** : deux immobilisations en base, toutes deux acquises en novembre et
  décembre — le profil où le défaut est maximal — mais dans des bacs à sable abandonnés. Comme les
  autres de cette famille, ce qui le rend digne d'être corrigé est qu'un résultat intermédiaire faux
  est un chiffre plausible que personne ne redérive.
  **L'écart de février est écrit dans un test plutôt que corrigé** : en 30/360 un 28 février vaut
  58/360 et non 60, et avoir DEUX conventions pour la même dotation serait pire que ces 2/360.
  **Neuf mutations mordent** — dont le code tel qu'il était, la borne de fin qui raboterait aussi
  l'année pleine, et **la période qui déborde sur l'exercice précédent, qui a d'abord SURVÉCU** :
  le jeu d'essai ne portait aucune pièce de l'année d'avant, donc l'autre borne n'était gardée par
  rien. Une mutation qui ne mord pas accuse d'abord le jeu d'essai.
- **ET LE MÊME ÉCRAN DIVISAIT PAR LE NUMÉRO DU MOIS** (22/09/2026, trouvé dans la foulée du
  précédent — c'est l'autre moitié de la même question de période). La CAF annuelle estimée est un
  chiffre observé sur une partie de l'année puis ramené à douze mois, et le diviseur était
  `new Date().getMonth() + 1`. **Ce nombre n'est exact que le DERNIER jour de chaque mois.**
  **Mesuré** : la CAF annoncée valait **52 % de la juste au 1er février**, 84 % au 1er juin, 89 % au
  1er septembre. Toujours dans le sens pessimiste — jamais flatteuse, donc jamais dangereuse au sens
  de la « bonne nouvelle fabriquée » — mais jamais vraie non plus, sur la capacité de remboursement
  qu'une banque regarde en premier.
  **Et l'écran ÉCRIVAIT ce nombre**, « sur 9 mois écoulés cette année » un 1er septembre : ce
  n'était pas seulement un diviseur faux, c'était une affirmation fausse. CLAUDE.md citait d'ailleurs
  cette étiquette parmi les « chiffres ÉTIQUETÉS de leur année » du balayage `useAnnee` — elle était
  bien étiquetée, l'étiquette était fausse.
  **CE QUE LE CORRECTIF COÛTE, ET IL EST BORNÉ** : en janvier, annualiser dix jours revient à
  multiplier par 36, et le chiffre bougerait d'un facteur dix à chaque facture saisie.
  `ratiosBancaires` refuse donc d'annualiser moins d'un mois d'observation, et l'écran affiche
  « — » — dire qu'on ne sait pas encore vaut mieux qu'un nombre dont seule l'apparence est stable.
  C'est le même arbitrage que « mieux vaut un contrôle qui ne tourne pas qu'un import qui perd des
  recettes ».
  **Le test d'écran FIXE l'horloge**, et c'est ce qui décide de ce qu'il garde : lu sur l'heure
  courante, il dirait autre chose chaque jour — et serait vert par hasard le 30 du mois, c'est-à-dire
  précisément le jour où l'ancien calcul était juste. Quatre mutations mordent, dont le code tel
  qu'il était et la garde symétrique du plancher.
- **ET LA TROISIÈME BRIQUE DU MÊME DOSSIER BANCAIRE PROJETAIT SUR RIEN, SANS LE DIRE** (22/09/2026,
  dernier des trois — la question de période posée à la dernière brique).
  **`lignesBanque` N'EST PAS `lignes_bancaires`**, et c'est ce qui a renversé le diagnostic :
  `FinancementTab` lit `ecritures_brouillon` filtrée sur le compte 512000, c'est-à-dire ce qui a été
  COMPTABILISÉ, jamais le relevé importé. Ma première mesure portait sur la mauvaise table et
  concluait « latent » ; refaite sur la bonne, **les quatre dossiers portent 0 écriture bancaire pour
  954 lignes de relevé importées**. Ce n'est donc pas latent du tout : tout dossier ouvrant cet écran
  aujourd'hui lit « 0,00 € d'encaissements observés » et une projection PLATE, sur le document qu'un
  cabinet montre à une banque. Le choix de source, lui, est légitime et reste : la trésorerie d'un
  cabinet est celle de sa comptabilité, pas celle d'un fichier déposé.
  **LE MODULE AVAIT RAISON DE RENDRE 0** — son test « reste à zéro sans historique bancaire » le fige
  depuis toujours. Ce qui manquait est de pouvoir DISTINGUER ce zéro-là d'un zéro observé : les deux
  produisaient le même écran. Famille déjà connue, dans sa forme la plus coûteuse — **le vide est une
  AFFIRMATION** (`AccesTab` « Aucun accès client », `SuperPdpFactureModal` « Aucun événement ») : ici
  le plan annonce une activité nulle là où il n'a rien lu, et le taux d'endettement affiche « — » sans
  distinguer « pas encore d'historique » de « le rythme est nul ».
  **LE DIVISEUR NE BOUGE PAS, et c'est la moitié du correctif qui se raconte mal.** La tentation est
  de diviser par les seuls mois servis ; ce serait faux, un mois calme étant un VRAI zéro — un cabinet
  en congés deviendrait deux fois plus actif, c'est-à-dire une bonne nouvelle fabriquée, le pire sens
  de cette famille. **Le code ne peut pas distinguer « rien lu » de « rien encaissé »** ; l'écran, lui,
  peut poser la question. On DIT l'assiette, on ne la corrige pas, et un test fige le diviseur.
  **Les deux cas ne se fondent pas** : « rien à observer » est une moyenne qui ne repose sur rien,
  « observé sur une partie » est une moyenne juste dont l'assiette est plus courte que l'étiquette ne
  le laisse croire. Les fondre ferait porter à l'un la conséquence de l'autre — même raison que les
  DEUX bandeaux de `BandeauLecturePartielle`. Et la réserve est **rendue vide quand elle n'apprend
  rien**, comme `dotationsNonProratisees`.
  **Sept mutations mordent, et la DISCRIMINATION est le résultat** : le diviseur et les deux compteurs
  ne font tomber que des tests de module, le câblage de la modale Dettes & ratios ne fait tomber qu'un
  test d'écran — donc les deux câblages sont gardés séparément, là où une seule assertion aurait laissé
  croire que l'un couvre l'autre. Plus le code tel qu'il était (3 + 3) et les gardes symétriques des
  deux côtés, sans lesquels « l'écran prévient » serait satisfait par un écran qui prévient TOUJOURS.
  **ET LE TROISIÈME CONSOMMATEUR DE LA MÊME SOURCE A FAILLI ÊTRE OUBLIÉ** — « chercher toutes les
  copies avant de corriger la première », pris par son côté le plus banal : j'avais câblé les deux
  consommateurs qui passent par `calculerPlanTresorerie` et laissé le `tresorerieADate` de la
  Situation intermédiaire, qui lit les mêmes lignes directement. « Trésorerie à cette date : 0,00 € »
  y est **arithmétiquement JUSTE** quand rien n'est comptabilisé, et c'est exactement ce qui le rend
  dangereux : indiscernable d'un compte réellement vide, sur l'état qu'un cabinet montre à une banque.
  **Les deux réserves ne regardent PAS la même fenêtre**, et c'est pourquoi elles restent deux :
  `reserveSurMoyenne` parle des N derniers mois, `reserveSurSolde` de TOUT l'historique — un dossier
  dont les seules écritures datent de deux ans a un solde parfaitement juste et une moyenne qui ne
  repose sur rien. Un test porte ce cas nommément.
  **MAIS ELLES NE S'AFFICHENT QU'UNE FOIS**, un historique vide impliquant une fenêtre vide : les
  afficher toutes deux répétait la même phrase en rouge sous elle-même, et une mise en garde qu'on
  répète cesse d'être lue. `reserveSolde ?? reserve` — la première couvre les deux chiffres, et le cas
  « fenêtre partielle », qui n'a aucun équivalent côté solde, reste dit.
  **LA MUTATION QUI RECOLLE LES DEUX A SURVÉCU, ET C'EST LE TEST QU'IL FALLAIT ACCUSER** :
  `queryAllByText` compte des NŒUDS, pas des occurrences — deux mises en garde concaténées dans un
  même paragraphe lui rendaient encore « 1 ». D'où un compteur sur le `textContent`, et une mutation
  de plus qui le ramène au comptage de nœuds pour prouver que c'est bien LUI qui garde la garantie et
  non la phrase du commentaire. Six mutations de plus, toutes mordent.
  **Résultat négatif à garder** : le reste de `planTresorerie` est juste — bornes comparées en chaînes,
  mois en cours exclu, échéances rendues à part plutôt que fusionnées dans la moyenne. Ne pas le
  réenquêter ; ce qui reste ouvert est une question produit, pas un défaut.
- **ET « MAINTENANT » LU AU CHARGEMENT D'UN MODULE EST FIGÉ POUR TOUTE LA SESSION** (22/09/2026).
  Un module ne s'évalue qu'une fois, et cette application est une SPA en `HashRouter` : elle ne
  recharge JAMAIS la page. Un onglet de cabinet laissé ouvert — le cas normal, c'est l'outil du
  quotidien — garde donc l'année et le compte de mois du jour où il a été ouvert. **Sept constantes**
  de module en dépendaient, dans cinq écrans.
  **CE QUI COÛTE N'EST PAS LA PÉREMPTION, C'EST L'APPARIEMENT**, et un seul écran était dans ce cas :
  `ClientHome` figeait son `ANNEE_COURANTE` au chargement du module et recalculait ses `moisEcoules` à
  chaque rendu. Au passage d'une année, il affichait donc **« Relevés bancaires 2026 » avec RIEN à
  envoyer**, alors que les douze mois de 2026 sont dus — `Array.from({ length: 0 })` est vide. C'est
  une **bonne nouvelle fabriquée**, le pire sens de cette famille (personne ne va vérifier une bonne
  nouvelle), **étiquetée d'une année précise**, sur l'écran dont le métier est de dire ce qui manque.
  Et il contredisait `ClientUpload`, alors que ce fichier pose que ces trois écrans « doivent toujours
  dire la même chose au même moment ».
  **LES QUATRE AUTRES CONSTANTES SONT LÉGITIMES, résultat à garder** : `ClientUpload` et `DossiersList`
  figeaient les DEUX valeurs ensemble, donc cohérentes ; `ClientSimulation` et `EstimationTab` utilisent
  la leur partout dans l'écran ET l'ÉTIQUETTENT (« Projection 2026 »), donc un onglet périmé est périmé,
  **pas faux** — c'est la règle des « chiffres ÉTIQUETÉS de leur année » prise par son bon côté. Les deux
  dernières restent en exceptions écrites ; les deux premières sont passées au calcul par rendu, ces
  trois écrans devant s'accorder.
  **LE REMÈDE SUPPRIME LE PIÈGE AU LIEU DE LE GARDER** : `moisEcoulesCetteAnnee()` disparaît au profit
  d'`anneeEtMoisEcoules()`, qui rend les DEUX depuis un seul `Date`. « 8 mois écoulés » ne désigne des
  mois que rapporté à SON année — les obtenir séparément était la condition du défaut. Le compilateur a
  d'ailleurs énuméré les quatre appelants d'un coup, exhaustivement : « un piège qu'un nom supprime vaut
  mieux qu'un piège gardé par un contrôle », appliqué cette fois à une SIGNATURE.
  **ET `tsc` N'A PAS VU LA ZONE MORTE TEMPORELLE que le correctif introduisait** : la déclaration
  destructurée s'est d'abord retrouvée APRÈS son premier usage (`depotsAnnee`, quatorze lignes plus
  haut), ce qui lève à l'exécution. Le compilateur attrape `X` utilisé avant `const X`, pas
  `const { annee: X } = …`. Trouvé en relisant l'ordre, pas par un outil.
  **LA RÈGLE DEVIENT UN SCANNER** (`maintenantFige.test.ts`), qui part de TOUTE source de production et
  n'admet que des exceptions écrites portant **la raison pour laquelle figer cette valeur est sans
  conséquence** — deux à ce jour, et le COMPTE fait foi. Cinq mutations mordent, dont le défaut d'origine
  replanté et le scanner rendu aveugle.
  **UNE SIXIÈME SURVIT, ET C'EST ÉCRIT DANS LE TEST plutôt que maquillé** : remplacer le `Date` unique
  par deux appels ne peut diverger qu'en enjambant un réveillon à quelques microsecondes près, ce
  qu'aucune horloge feinte ne produit entre deux instructions synchrones. La forme à un seul `Date` est
  gardée parce qu'elle tient par CONSTRUCTION — même statut que la part non déductible calculée par
  complément dans `declaration2035`.
  **CE QUI RESTAIT UNE QUESTION PRODUIT A ÉTÉ TRANCHÉ PAR LE CABINET LE 22/09/2026, ET CORRIGÉ** :
  au 1er janvier, « ce qu'il reste à envoyer » repartait à zéro sur la nouvelle année et cessait d'un
  coup de réclamer l'exercice révolu — voir l'entrée dédiée plus bas. La borne retenue est la CLÔTURE
  et non une date fixe.
  **ET LE PASSAGE AU CALCUL PAR RENDU A FAIT REVENIR LE DÉFAUT D'APPARIEMENT DANS `DossiersList` — C'EST
  LE LINT QUI L'A MONTRÉ** (25/09/2026). « La lire à chaque rendu » est juste pour les trois écrans de
  « ce qu'il reste à envoyer », qui lisent TOUT le dossier puis calculent : l'année du rendu s'applique
  à des données complètes. `DossiersList`, lui, FILTRE ses lectures sur l'année au chargement
  (`gte('date', debutAnnee)` — elles portent sur tout le cabinet) et range le compte de mois dans
  chaque ligne. Son en-tête, recalculé à chaque rendu, passait donc à la nouvelle année au premier
  rendu d'après le Nouvel An — une recherche tapée suffit — au-dessus des chiffres de l'année finie :
  **« Relevés 2027 » sur « 11/11 mois »**, et « Cotisations 2027 » cochée sur des cotisations de 2026.
  La bonne nouvelle fabriquée de `ClientHome`, réintroduite par son propre correctif, sur l'écran qui
  décrit tout le cabinet. Et la phrase ci-dessus qui classait `DossiersList` parmi les constantes
  « légitimes » passées au calcul par rendu décrivait l'intention, pas le résultat.
  **Le critère qui départage** : l'année se lit à chaque rendu quand les données ne sont pas filtrées
  sur elle ; quand la lecture la filtre, elle se lit AU MÊME INSTANT que les données et VOYAGE avec
  elles (`anneeChargee`, posée dans le même lot que les lignes). Figée au chargement du module — l'état
  d'avant —, elle ne changeait plus de la session ; gardée dans l'état, elle suit chaque rechargement.
  **Signalé par `react-hooks(exhaustive-deps)`, qui n'était pas du bruit** : `load()` lisait deux
  valeurs du rendu sans que l'effet dépende d'elles. C'était l'un des deux avertissements qui faisaient
  passer la branche de 66 à 68, au-dessus du plafond de `main`, trouvé en voulant les faire disparaître.
  L'autre était une mémoïsation inopérante dans `BanqueTab` (`nonRapprochees` recréée à chaque rendu,
  donc `planAuto` recalculé à chaque frappe) : une affaire de performance et non de justesse, gardée
  par le lint seul — c'est dit plutôt que déguisé en test.
  **Trois tests, horloge feinte sur `Date` seule, et trois mutations qui mordent chacune sur le test
  écrit pour elle** : le code tel qu'il était (en-tête par rendu) sur « passer le Nouvel An écran
  ouvert » ; l'année jamais reposée par `load()` sur « une liste RECHARGÉE » — créer un dossier relance
  le chargement sans remonter l'écran, et sans ce cas un en-tête figé au montage passait ; l'année
  figée au niveau du module sur les deux derniers, plus le scanner, qui la voit aussi.
  **LATENT** : il faut une liste restée montée à travers minuit le 31 décembre, puis un rendu — le cas
  normal d'un outil de cabinet laissé ouvert, et rien ne le signalerait.
- **ET AU 1ER JANVIER, LES TROIS ÉCRANS CESSAIENT DE RÉCLAMER L'EXERCICE QU'ON CLÔTURE**
  (22/09/2026). `moisEcoules` vaut 0 le 1er janvier, et les trois écrans ne connaissaient que l'année
  EN COURS : ils n'avaient donc plus rien à réclamer, ni pour la nouvelle année (aucun mois révolu),
  ni pour l'ancienne (qu'ils ne regardaient pas). **Une bonne nouvelle fabriquée** — le pire sens de
  cette famille, personne n'allant vérifier une bonne nouvelle — au moment précis où un cabinet court
  après les pièces de l'exercice qu'il clôture.
  **LA BORNE EST LA CLÔTURE, PAS UNE DATE FIXE** (choix du cabinet, 22/09/2026) : on continue de
  réclamer tant que personne n'a coché que l'exercice est clos. Une date arbitraire (« jusqu'au
  30 avril ») se serait trompée sur tous les dossiers EN RETARD, c'est-à-dire exactement ceux qui ont
  besoin qu'on réclame. La marque est `exercices_clotures`, celle que pose déjà le bouton de
  `ClotureTab` — **une seule marque, pas deux** : en créer une seconde aurait laissé deux vérités sur
  la même question. Sa policy a été élargie au CLIENT en lecture seule (clôturer reste un geste de
  cabinet), vérifiée par impersonation réelle des trois profils, sept contrôles dont le POSITIF sans
  lequel trois refus seraient satisfaits par une policy qui refuse tout le monde.
  **CONSÉQUENCE À CONNAÎTRE** : cocher la clôture pour faire taire la réclamation déclenche AUSSI
  la purge du texte OCR des pièces sensibles de l'exercice (RGPD.md §8.3). Les deux effets tiennent
  à la même ligne.
  **ET J'AI ÉCRIT ICI MÊME, LE JOUR OÙ JE L'AI BRANCHÉ, QUE « LA CONFIRMATION LES NOMME TOUS LES
  DEUX ». C'ÉTAIT FAUX.** Le message ne nommait que la purge — la seule conséquence qui existait
  quand la routine l'a écrit —, et la seconde est précisément celle qui fait venir cliquer ici. Une
  confirmation qui n'en nomme qu'une laisse cocher pour l'une et SUBIR l'autre. C'est exactement la
  famille « une mise en garde écrite au-dessus d'un code qui ne la tient pas » que ce fichier nomme
  trois fois ailleurs, fabriquée cette fois dans la même session que la règle qu'elle enfreint —
  trouvée en relisant mes propres affirmations plutôt qu'en relisant le code. Le message nomme
  désormais les deux, et **un test le garde nommément**, comme pour `VehiculesCard.supprimer` et
  `AccesTab.revoke` : trois mutations mordent, dont le code tel qu'il était et le garde symétrique
  sans lequel « la confirmation nomme les deux » serait satisfait par un bouton qui ne clôture
  JAMAIS.
  **L'ARITHMÉTIQUE D'EXERCICE VIT DÉSORMAIS DANS `lib/resteAEnvoyer.ts`.** Elle était écrite TROIS
  FOIS et avait déjà divergé deux fois — le mois en cours compté comme dû d'un seul côté, puis
  l'année figée au chargement du module sur un seul des trois. Ce qui reste aux écrans est ce qui
  diffère LÉGITIMEMENT : le registre des libellés (on tutoie le client), et le critère de comptage
  des pièces (dépôts côté client, `date_piece` côté cabinet — voir l'entrée suivante). Les fondre
  serait une régression, pas une simplification.
  **Trois arbitrages écrits** : on ne réclame JAMAIS au-delà de N-1 (un dossier ouvert depuis cinq
  ans dont personne n'a coché la clôture afficherait cinq exercices en permanence, et une mise en
  garde permanente cesse d'être lue) ; un point SATISFAIT d'un exercice révolu ne s'affiche pas (sans
  quoi un dossier à jour afficherait SIX points pour dire qu'il ne reste rien) ; et une lecture de
  clôtures REFUSÉE se passe en « rien de clos », donc on continue de réclamer — l'inverse ferait
  cesser de demander sur une panne, ce qui est indiscernable d'un dossier à jour. La réserve le DIT,
  dans les deux registres depuis un seul endroit.
  **Correction au passage** : la tuile « Relevés » comptait les mois PRÉSENTS et non les mois révolus
  reçus, donc affichait « 13/8 » sur un relevé daté d'un mois à venir (ClientHome le rattrapait par
  un `Math.min`, la Checklist non).
  **7 mutations sur le module, 5 sur le câblage, toutes mordent** — dont le code tel qu'il était des
  deux côtés et les deux gardes symétriques (« l'écran n'affiche plus rien », « la réserve s'affiche
  toujours »). **L'HORLOGE DU TEST D'ÉCRAN EST FIXÉE** au 5 janvier : lue sur l'heure courante, elle
  serait verte par hasard onze mois sur douze, le défaut ne se voyant qu'au passage d'une année.
  Piège à connaître : `vi.useFakeTimers()` gèle AUSSI les minuteurs dont `findByText` dépend, et
  chaque test part alors en expiration — une panne qui ne ressemble pas au défaut gardé. On ne feint
  que `Date` (`toFake: ['Date']`).
- **ET « LES TROIS ÉCRANS DISENT LA MÊME CHOSE » N'ÉTAIT VRAI QUE DE DEUX POINTS SUR TROIS**
  (22/09/2026, trouvé en vérifiant l'invariant que le correctif ci-dessus venait de rétablir).
  Relevés bancaires et cotisations : identiques au caractère près dans `ClientHome`, `ClientUpload` et
  `ChecklistTab`. **Le troisième point ne compte pas la même chose** — les écrans CLIENT comptent les
  DÉPÔTS (`created_at`), la Checklist compte les pièces DATÉES de l'année (`date_piece`).
  **Mesuré sur le dossier vivant : 43 pièces déposées en 2026, UNE SEULE datée de 2026.** Le dépôt suit
  la date de pièce de 549 jours en médiane (chiffre déjà établi ici) : les deux questions n'ont donc pas
  des réponses voisines, elles ont des réponses d'un ordre de grandeur d'écart, sous des libellés
  presque identiques — « Factures et documents 2026 » contre « Factures / pièces 2026 ».
  **LES DEUX FILTRES SONT JUSTES, ET AUCUN N'EST CHANGÉ** : le client demande « ai-je envoyé quelque
  chose ? », le cabinet « ai-je de quoi travailler sur l'exercice ? », et le bouton de la Checklist mène
  à Pièces, dont le filtre d'exercice lit lui aussi `date_piece`. Trancher autrement serait une décision
  produit. Ce qui est corrigé est **ce que chaque écran AFFIRME** : la Checklist disait
  « N pièce(s) déposée(s) », elle dit « N pièce(s) datée(s) de cette année ».
  **ET SON COMMENTAIRE DISAIT L'AUTRE QUESTION** — « toutes les pièces REÇUES cette année : ce point
  vérifie que le client a bien envoyé quelque chose ». C'est mot pour mot la sémantique des écrans
  client, au-dessus d'un code qui filtre sur la date du document. Famille connue de ce dépôt (« un nom
  qui ment sur son filtre », « une mise en garde au-dessus d'un code qui la contredit »).
  **LE DÉFAUT QUI COÛTE, LATENT** : `p.date_piece && …` écarte les pièces sans date, donc le point
  affichait « Aucune pièce déposée pour cette année » alors que le client venait d'envoyer — et l'écran
  du CLIENT, lui, les comptait. Le cabinet relance pour des documents déjà reçus, sur le seul écran qui
  prétend dire ce qui manque. **Mesuré : zéro pièce sans date en base aujourd'hui** (la campagne du
  20/09 les a comblées), donc non producible — l'état revient au premier dépôt dont l'OCR ne lit pas la
  date. La mention est calculée, donc vide quand elle n'apprend rien.
  **Quatre mutations mordent, et la quatrième a d'abord SURVÉCU** : retirer le filtre d'année laissait
  tout vert, le jeu d'essai ne portant que des pièces de l'année en cours — l'assiette n'était gardée
  par rien. Une mutation qui ne mord pas accuse d'abord le jeu d'essai.
- **ET LA MÊME QUESTION POSÉE AUX COTISATIONS A RENDU UNE DÉDUCTION DE TROP** (21/09/2026).
  `calculerDeclaration2035` porte la cotisation **complète** au poste « Cotisations sociales
  personnelles » (case BK, ligne 25). Or la CSG-CRDS d'un travailleur non salarié se décompose en
  **6,8 points déductibles** du résultat BNC et **2,9 qui ne le sont pas** (CSG non déductible 2,4 +
  CRDS 0,5). La part non déductible partait donc en déduction sur une déclaration signée.
  **L'application savait la ventiler et ne s'en servait pas** : `cotisations_declarees.montant_csg_crds`
  existe, l'écran Cotisations le saisit, et il AFFICHAIT même la part déductible — avec les deux taux
  écrits en dur DANS le composant, donc hors de portée des tests et invisibles pour le moteur. Ils
  vivent désormais à côté du contrôle qui s'en sert (`partCsgNonDeductible`, lib/declaration2035.ts).
  **On signale, on ne corrige pas** — l'en-tête du moteur le dit (« il totalise, il ne déclare pas »),
  et c'est le parti pris de `doublonFraisVehicules` comme de `dotationsNonProratisees`.
  **Deux états distincts, et c'est le cœur du contrôle** : ce qu'on sait chiffrer, et ce qu'on ne sait
  pas. Une cotisation sans ventilation ne vaut pas « zéro de CSG » — les confondre ferait annoncer
  « rien à réintégrer » sur un dossier qui n'a jamais renseigné le détail, **ce qui est le cas de toute
  la production aujourd'hui** (mesuré : 43 cotisations en base, 0 ventilée). Famille des résultats
  vides qui ressemblent à une réponse, appliquée cette fois à une SAISIE manquante.
  **ET LA QUESTION OUVERTE A ÉTÉ TRANCHÉE SUR PIÈCE LE 22/09/2026 — LE MOTEUR CORRIGE DÉSORMAIS.**
  Il était écrit ici que deux présentations sont admises et que le moteur n'en choisissait aucune.
  Une 2035 réelle déposée par le cabinet a tranché, cases relevées à leurs COORDONNÉES sur le PDF
  (le texte joint n'attribue aucun montant à aucune case — il a fallu extraire les positions) :
  - **BV** (2035-A ligne 14, « Contribution sociale généralisée déductible ») : **remplie** ;
  - **CC** (2035-B ligne 36, « Divers à réintégrer ») : **vide**, donc aucune réintégration ;
  - ligne 25 : BT « dont obligatoires » + BZ « dont facultatives » = BK **au centime**, sans la CSG —
    c'est cette égalité qui prouve que chaque montant a été attribué à la bonne case.
  **ET C'EST FORCÉ PAR LE FORMULAIRE, pas seulement observé** : BK entre dans le total des lignes 8 à
  32 et BV y entre aussi par la ligne 14, donc la CSG présente dans les deux serait déduite DEUX FOIS.
  Côté tenue de comptes, l'expert-comptable passe la CSG-CRDS **entière au compte 108** (compte de
  l'exploitant), donc hors résultat ; seule la part déductible est réintroduite en BV. Les deux
  moitiés se tiennent, et la part non déductible n'apparaît alors nulle part.
  **Le moteur sort donc la CSG-CRDS ENTIÈRE de la ligne 25** et porte ses 6,8 points sur un poste à
  part, `POSTE_CSG_DEDUCTIBLE`, rattaché à BV. Retirer seulement le non déductible serait l'erreur
  tentante — une mutation la garde.
  **Les deux chiffres viennent de `partCsgNonDeductible`, jamais d'un second calcul** : c'est la même
  fonction qui alimente l'avertissement de Clôture, donc l'écran et le formulaire ne peuvent pas
  annoncer deux montants à un centime près (sommer puis arrondir n'est pas arrondir puis sommer, et
  un test le prouve sur trois cotisations à 33,33 / 33,33 / 33,34).
  **CE QUI RESTE SIGNALÉ SANS ÊTRE CORRIGÉ, et c'est tout ce qui reste** : une cotisation dont
  `montant_csg_crds` n'est pas saisi. On ne peut alors rien ventiler — le taux ne s'applique pas au
  montant total d'un appel — donc sa part non déductible continue de partir en déduction. **C'est
  l'état de 100 % de la production** (43 cotisations, 0 ventilée) : le correctif est juste et INERTE
  tant que personne ne saisit la CSG-CRDS. L'écran ne parle plus que de ce cas-là, et se tait sur
  une cotisation ventilée — redire une chose déjà faite est la mise en garde permanente qu'on refuse.
  **Six mutations, et la sixième a d'abord SURVÉCU** : retirer le rattachement `POSTE_CSG_DEDUCTIBLE →
  BV` laissait TOUT vert. Le moteur calculait bien les 680 €, ils tombaient dans `postesSansCase`, et
  rien ne le vérifiait — donc absents du formulaire, sur la case même que ce chantier existe pour
  remplir. Le garde vit désormais dans `cases2035.test.ts`, et `cases2035.ts` IMPORTE la constante au
  lieu de retaper la chaîne, pour qu'un renommage ne puisse pas casser le rattachement en silence.
  **Neuf mutations posées, huit mordent** — et la neuvième est à garder telle quelle : le commentaire
  qui l'annonçait était FAUX. Il était écrit que calculer le non déductible sur 2,9/9,7 plutôt que par
  complément laisserait un centime d'écart. **Mesuré sur les 20 000 000 de montants au centime de
  0,01 € à 200 000 € : zéro écart**, et c'est arithmétique (6,8 + 2,9 = 9,7, donc les parties
  fractionnaires se complètent exactement). Écrit comme tel dans le module plutôt que maquillé en
  assertion de complaisance — la forme par complément est gardée parce qu'elle tient par CONSTRUCTION,
  le jour où l'un des deux taux changera.
  **Et un garde symétrique qui ne mordait pas, corrigé plutôt qu'accepté** : « se tait sur un exercice
  sans cotisation » rend `null` de toute façon, donc « avertit toujours » y passait inaperçu. C'est un
  appel de retraite ventilé à **zéro** de CSG — un cas réel — qui sépare les deux.
- **UN BOUTON QUI OUVRE UN FICHIER NE FAIT JAMAIS RIEN EN SILENCE** (21/09/2026). Cinq copies de
  « signer une URL puis ouvrir un onglet » — `depot.ts::ouvrirJustificatif`, `CotisationsTab`,
  `DocumentsTab`, `PacksTab`, `InformationsTab` — avaient divergé sur les trois points qui comptent.
  - **La raison.** Trois disaient « Aperçu indisponible » sans passer par `messageErreur`.
    `PacksTab.download` faisait pire : il LISAIT son erreur puis faisait `return`, donc le bouton de
    téléchargement d'un pack ne faisait visiblement RIEN — sur le livrable qu'on envoie au comptable,
    et c'est mot pour mot le défaut corrigé la veille sur l'export d'`InformationsTab`, resté entier
    sur l'autre chemin de téléchargement du MÊME fichier.
  - **`noopener`.** Une seule des cinq le passait.
  - **LE BLOCAGE DE FENÊTRE, et c'est le vrai défaut** : aucune ne lisait le retour de `window.open`.
    Appelé après un `await` — ce que font les cinq, puisqu'elles attendent une URL signée — il sort
    de la fenêtre d'activation transitoire du navigateur, **rend `null`, et il ne se passe rien** :
    ni onglet, ni message. Un bouton cassé a exactement la même tête.
  **ET C'EST `noopener` QUI RENDAIT LE TROISIÈME POINT INDÉTECTABLE**, le piège à retenir :
  `window.open(url, '_blank', 'noopener')` rend `null` **même quand il réussit** — la spécification
  HTML refuse de donner une référence à l'ouvrant — donc succès et blocage y sont indiscernables.
  On ouvre sans le mot-clé, on teste le retour, PUIS on coupe la référence par `onglet.opener = null`,
  qui protège autant et laisse le blocage visible.
  **Point unique `lib/apercu.ts`**, comme `retirerFichiers` pour les retraits, et **la règle devient
  un scanner** : plus aucun `window.open` hors de ce fichier, exceptions écrites portant leur raison
  (une, le point unique lui-même). Onze mutations mordent, dont le défaut d'origine, le retour à
  `noopener`, la lecture « par ligne » du scanner et les deux gardes symétriques de `PacksTab`.
  **ET LE FAUX `window.open` D'UN TEST EXISTANT ÉTAIT INFIDÈLE** : celui d'`InformationsTab` rendait
  `null` en toutes circonstances, donc le test du cas PASSANT exerçait sans le dire le chemin du
  blocage — *un jeu d'essai infidèle ne fait pas qu'affaiblir un test, il lui fait prouver autre
  chose*. Le faux d'`apercu.test.ts` MODÉLISE désormais la règle `noopener` du navigateur : sans cette
  fidélité-là, la mutation qui remet le mot-clé ne mordait pas, et le module aurait perdu en silence
  sa seule façon de voir un blocage.
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

- **ET TOUS CES GARDES RÉPONDENT À « LA LECTURE EST-ELLE COMPLÈTE ? » — AUCUN À « EST-CE LES BONNES
  LIGNES ? »** (23/09/2026). La règle du tri TOTAL est écrite depuis le portage et répétée dans trois
  commentaires de production (`lectureComplete.ts`, `exportCabinet.ts`, `agent-comptable`) : « sans clé
  de départage, deux tranches se recouvrent ou sautent des lignes, et rien ne le signale ». Elle
  n'était gardée NULLE PART.
  **Ce qui la rend différente de tout ce que ce dépôt garde déjà** : `lireTout` reçoit une FERMETURE.
  Il ne voit pas la requête, donc il ne peut pas exiger le tri — la règle vit entièrement dans les
  cent vingt sites d'appel, réécrite à la main à chaque fois.
  **ET LA CONSÉQUENCE EST PIRE QUE LA TRONCATURE ORDINAIRE, ce qui est le cœur du chantier.** Postgres
  ne garantit aucun ordre stable entre deux `range()` quand l'`ORDER BY` a des ex æquo : une ligne
  peut revenir deux fois pendant qu'une autre n'est jamais servie. La boucle accumule alors
  exactement le nombre de lignes ANNONCÉ, s'arrête, et `lignes.length === annonce` — donc
  **`complete: true`, `motif: null`**, sur un jeu qui porte un doublon et à qui il manque une ligne.
  `lecturesPaginees` (annonce-t-on un compte ?), `lecturesSignalees` (lit-on le drapeau ?),
  `lecturesVerifiees` (lit-on l'erreur ?) et `BandeauLecturePartielle` (le dit-on à l'opérateur ?)
  sont tous aveugles à ce cas **par construction** : le drapeau dit vrai sur la LONGUEUR, c'est le
  CONTENU qui est faux. Un FEC, une balance ou une piste d'audit bâtis là-dessus sont une bonne
  nouvelle fabriquée, la pire forme de cette famille. Le test l'EXÉCUTE contre un faux serveur plutôt
  que de l'affirmer, avec sa garde symétrique (une troncature ordinaire, elle, se signale bien).
  **MESURÉ AVANT D'ÉCRIRE QUOI QUE CE SOIT : 123 sites d'appel, 117 écrivent leur tri à la main, et
  les 117 terminent par la clé primaire.** Zéro faute — `dossiers` trié `nom, id`, `pieces` trié
  `date_piece, id`, `cabinet_admins` sur `user_id` qui EST sa clé. Ce contrôle ne corrige donc rien.
  Comme `edgeFunctionsCodeMort`, il est refermé sur un trou DÉMONTRÉ et non sur un défaut trouvé, et
  la différence mérite d'être écrite : ce qui le justifie est que la 118e lecture s'écrira à la main
  comme les autres, et que rien ne la regarderait.
  **DEUX PAGINEURS, ET UN SEUL EST À LA MERCI DE QUI ÉCRIT** — d'où deux portes. `lireTout(fermeture)`
  porte son tri dans la fermeture : c'est la porte 1, les 117 sites. `lireToutesLesLignes(table, …)`
  (socle de sauvegarde) le DÉRIVE de `CLES_PRIMAIRES`, colonne par colonne — ce qui compte pour les
  six tables à clé composite, où trier sur la première ne départage rien : la porte 2 vérifie cette
  dérivation plutôt que ses six sites, le CONTENU de `CLES_PRIMAIRES` étant déjà épinglé au schéma
  par `sauvegardeClesPrimaires.test.ts`. Elle interdit aussi tout `.order(` littéral dans le socle.
  **UNE TABLE NON RECONNUE EST UNE FAUTE, JAMAIS UN SAUT** : sans cette décision, une lecture écrite
  d'une forme que le détecteur ne sait pas lire passerait en silence — la panne que ce dépôt connaît
  sous six noms. Et la dérivation des clés primaires a été SORTIE du test d'hier vers
  `src/test/schema.ts` plutôt que recopiée : une clé primaire lue de deux façons différentes est
  exactement ce qu'aucun test ne verrait.
  **LA RÈGLE DU NOMBRE EST EXERCÉE ALORS QU'AUCUNE EXCEPTION N'EXISTE**, sur une source synthétique,
  et c'est délibéré : un comptage que rien n'a jamais fait tourner est faux le jour où quelqu'un
  inscrit la première dispense — c'est mot pour mot ce qui venait d'être trouvé sur trois scanners
  le 22/09/2026.
  **Dix mutations mordent, et la ONZIÈME SURVIT — c'est elle le résultat.** Pointer le balayage sur
  AUCUN dossier réel ne fait tomber QUE le plancher (les cas synthétiques s'injectent dans le
  scanner et continuent de mordre) ; la même mutation AVEC les trois bornes du plancher neutralisées
  ne fait tomber PLUS RIEN. Le plancher est donc la seule chose qui distingue « zéro faute »
  d'« aveugle », démontré plutôt qu'affirmé. Les neuf autres : le défaut replanté dans un vrai site
  (`exportCabinet`), le scanner aveugle, le scanner qui crie au loup, les définitions comptées comme
  des appels, la clé primaire non dérivée du schéma, le corps lu « à la ligne » (**huitième** fois
  que ce dépôt se ferait prendre par un retour à la ligne), la table inconnue sautée, l'exception
  inventée, et le socle qui ne trie plus que sur la première colonne.
  **Trouvé par un balayage dont la forme vaut plus que la prise** : les commentaires de production
  qui NOMMENT un dégât — « sinon », « en silence », « indiscernable », « sans que rien ne le
  signale » — 147 dans 63 fichiers. La plupart sont rétrospectifs (un défaut déjà corrigé, et
  gardé) ; ce qui compte est le petit reste PRESCRIPTIF, une propriété qu'une édition future
  casserait. Trois résultats négatifs à garder, pour ne pas les réenquêter : les invariants d'ordre
  de `sauvegarde.ts` sont rejoués sur le plan RÉEL **et** re-vérifiés à l'exécution
  (`sauvegardeDonnees.ts:194`) ; `nonCalcules` remonte bien jusqu'aux deux écrans (`ClotureTab:549`,
  `VehiculesCard`) ; et le filtre d'historique d'`agent-comptable` (jamais de rôle « system », jamais
  de bloc structuré) est correct — il reste le seul invariant de sécurité nommé en commentaire et
  gardé par rien, non porté ici parce qu'il demanderait de modifier et redéployer la fonction pour
  un défaut qui ne peut pas survenir aujourd'hui. Même arbitrage que les huit ternaires interdits.

- **ET LE SEUL INVARIANT DE SÉCURITÉ DU DÉPÔT GARDÉ PAR RIEN A ÉTÉ PORTÉ LE JOUR MÊME**
  (23/09/2026, décision du cabinet). L'entrée ci-dessus le laissait de côté — « un défaut qui ne peut
  pas survenir aujourd'hui » — et l'arbitrage a été renversé sur le bon critère : **revenir dessus le
  jour où quelqu'un aura touché au filtre coûte plus cher que de le poser maintenant**, parce qu'à ce
  moment-là plus rien ne dirait que la barrière a bougé.
  **CE QUE LE FILTRE GARDE.** `agent-comptable` reçoit le fil de conversation du NAVIGATEUR à chaque
  tour (`payload.historique`) : il ne le relit JAMAIS en base — sa seule lecture d'`agent_conversations`
  sert au plafond de coût, pas au contexte, et c'est vérifié plutôt que supposé. Le filtre est donc la
  seule barrière entre ce que le client poste et ce qui part dans `messages`, à côté du prompt système,
  sur un assistant qui lit la comptabilité d'un dossier. Trois portes : seuls `user` et `assistant`
  passent (un rôle « system » forgé serait une instruction d'opérateur) ; `texte` doit être une CHAÎNE
  (pas de bloc structuré) ; la fenêtre est bornée (20 tours, 4 000 caractères).
  **AUCUN DES SIX SCANNERS EXISTANTS NE POUVAIT LE VOIR** : ils lisent du TEXTE, et un filtre élargi
  d'un mot leur est indiscernable d'un filtre qui tient. Une Edge Function n'est appelée par aucun
  test, et rien ne recharge derrière. Le seul contrôle possible est celui des fonctions auto-portées,
  poussé d'un cran : **EXTRAIRE le bloc de la vraie source, le transpiler avec le compilateur du
  projet, et lui donner de vrais payloads forgés** — l'idiome d'`extractPiecePagination`, appliqué à
  une barrière de sécurité.
  **LA PRODUCTION A DONC ÉTÉ MODIFIÉE, et c'est ce que la décision achetait** : le filtre inline est
  devenu `historiqueDuClient` entre bornes `── DÉBUT/FIN HISTORIQUE`, avec ses deux plafonds NOMMÉS
  (`MAX_TOURS_HISTORIQUE`, `MAX_CARACTERES_TOUR`). Sans bornes déclarées, la limite d'extraction serait
  une instruction voisine arbitraire — un réarrangement changerait en silence ce qui est testé.
  **`agent-comptable` v23 EN PRODUCTION** le jour même : `verify_jwt` relu (`false`) et repassé
  explicitement, déployé comparé au dépôt AVANT écrasement (**identique à HEAD**, donc personne n'avait
  modifié la production à la main et aucun correctif n'attendait), aller-retour après : **zéro
  différence résiduelle sur 856 lignes**.
  **LE CÂBLAGE EST GARDÉ À PART DE LA FORME**, comme partout ailleurs : le bloc peut rester parfait
  pendant que le gestionnaire cesse de l'appeler. Ici il n'y a pas d'écran, donc c'est la source qui
  répond — le filtre est appelé, et `payload.historique` n'est lu NULLE PART ailleurs (une seconde
  lecture serait une seconde porte).
  **Dix mutations, toutes mordent, et la DISCRIMINATION est le résultat** : le rôle « system » admis
  et la liste blanche perdue en font tomber deux chacune ; le `texte` non exigé chaîne, la fenêtre
  prise à l'envers, la troncature élargie et l'historique non-tableau n'en font tomber qu'UNE chacune,
  celle écrite pour elles ; les deux mutations de câblage ne touchent que les tests de câblage ; et les
  bornes retirées font échouer le FICHIER ENTIER, qui est le plancher.
  **LA MUTATION QUI COMPTE EST CELLE QUE LA RELECTURE NE SUGGÈRE PAS** : le `.map` final ne met pas en
  forme, il RECONSTRUIT l'objet `{ role, texte }`. Remplacé par un `{ ...h }`, un tour au bon rôle et au
  bon texte ferait entrer tout ce qu'on lui accroche — un `content` en blocs, un `cache_control`, un
  champ que le SDK lira demain — et **les neuf autres tests restaient verts**.

- **« RAPPROCHÉ » EST UNE AFFIRMATION, ET ELLE SURVIT À CE QUI LA JUSTIFIAIT — CINQUIÈME FRAPPE DE
  « un contrôle qui part d'un côté d'une relation ne voit pas ce qui manque de l'autre », LA PREMIÈRE
  QUI PARTE DU MOUVEMENT BANCAIRE** (23/09/2026). Les quatre précédentes partaient de la pièce, de
  l'écriture ou de la catégorie. Le côté banque a pourtant ses deux clés à lui, `piece_id` et
  `cotisation_id`, et **toutes deux sont en `ON DELETE SET NULL`**.
  **MESURÉ AVANT D'ÉCRIRE QUOI QUE CE SOIT, et c'est la mesure qui a ouvert le chantier** : les CINQ
  clés étrangères entrantes de `pieces` (écritures, immobilisations, lignes bancaires, commentaires,
  textes OCR) et les DEUX de `cotisations_declarees` sont en SET NULL ou CASCADE — **aucune en
  NO ACTION**. Supprimer une pièce ou une échéance ne bloque donc JAMAIS : Postgres défait le lien
  sans un mot, et `statut` reste `'rapprochee'`.
  **CE QUE ÇA COÛTE, et c'est la forme la plus chère de la famille — le vide est une AFFIRMATION** :
  - la **Checklist** ne comptait que les `non_rapprochee`, donc elle se TAISAIT exactement dessus,
    sur l'écran dont le métier est de dire ce qui manque ;
  - l'onglet **Banque** affichait une pastille VERTE « Rapproché », **indiscernable d'un vrai
    rapprochement** : une pièce sans tiers rend exactement le même libellé nu (`piecePayee.tiers ?? ''`).
    Le mouvement est en prime sorti du filtre « Non rapprochés », donc de la vue par défaut ;
  - la **piste d'audit** part de l'écriture et du justificatif, jamais du mouvement — et une
    cotisation n'engendre AUCUNE écriture, donc sur ce chemin-là rien nulle part n'en parlerait.
  Le rapprochement était la seule chose qui rattachait cet euro à un justificatif ; le lien nul, plus
  aucun écran ne peut le retrouver.
  **LATENT, et mesuré** : 26 lignes rapprochées en base, 12 sur une pièce, 14 sur une cotisation,
  **ZÉRO orpheline**. Comme toute cette famille, ce qui le rend digne d'être corrigé n'est pas un
  préjudice constaté mais qu'il ne PEUT pas se voir une fois arrivé — et **deux gestes de l'interface
  le produisent aujourd'hui**, sur 26 lignes exposées.
  **ET LE MESSAGE QUI DEVAIT L'EMPÊCHER DISAIT LE CONTRAIRE DE LA VÉRITÉ.** `PiecesTab.deleteSelection`
  annonçait les pièces « liées à un rapprochement bancaire ou à un pack déjà généré » comme n'ayant
  pas pu être supprimées, et envoyait « retire d'abord ce lien ». **Les deux moitiés sont fausses** :
  23503 ne peut pas se lever sur `pieces` (aucune clé entrante en NO ACTION), et `packs` n'a plus
  aucune clé entrante du tout — `pack_pieces`, qui la portait, a été supprimée. Le compte `bloquees`
  restait atteignable (un refus RLS, une coupure) mais son EXPLICATION était inventée : une
  « contrainte justifiée par un appelant qui a disparu », la famille de `parseDate`, doublée d'une
  mise en garde au-dessus d'un code qui ne la tient pas. **La même phrase vivait en DEUX copies**
  (`PiecesTab` et `PieceFormModal`) — chercher toutes les copies avant de corriger la première.
  **LE REMÈDE EST DÉTECTER, PAS BLOQUER, et l'arbitrage est écrit plutôt que tu.** Une contrainte
  `check (statut <> 'rapprochee' or piece_id is not null or cotisation_id is not null)` ferait ÉCHOUER
  la suppression d'une pièce rapprochée — ce qui rendrait vraie la vieille phrase « retire d'abord ce
  lien ». Mais ce serait interdire un geste que l'interface permet aujourd'hui, donc une décision
  produit, pas une correction : **à poser avec l'utilisateur, jamais en passant**. Le précédent du
  projet est `ecrituresSansObjet`, qui SIGNALE et laisse le geste de réparation (« Annuler le
  rapprochement », déjà présent dans le panneau).
  **`mouvementsRapprochesSansObjet` (lib/controles.ts)** part donc du MOUVEMENT. Trois décisions :
  - **Le prédicat est exporté à l'unité** (`mouvementRapprocheSansObjet`) parce que l'onglet Banque
    en a besoin LIGNE PAR LIGNE pour sa pastille : le réécrire là-bas serait une règle recopiée deux
    fois, et c'est la pastille verte qui reviendrait sous un point de Checklist qui, lui, compterait.
  - **Seul le lien NUL est retenu**, jamais « désigne une pièce absente du jeu chargé » — la règle
    déjà posée pour `rupturesPisteAudit` : ce signal-là ne dépend d'aucun jeu de données à côté, donc
    il ne peut pas crier au loup sur un artefact de filtrage.
  - **`prelevement_personnel` n'est PAS écarté du prédicat** : un virement personnel est classé
    `'ignoree'` (mesuré : les 3 de la base le sont), donc il n'y entre pas de toute façon, et
    l'écarter laisserait croire qu'un virement personnel « rapproché » serait légitime.
  **ET LE COMMENTAIRE DE `types.ts` PROMETTAIT UNE CONTRAINTE QUI N'EXISTE PAS** : `cotisation_id`
  s'annonçait « mutuellement exclusif avec piece_id (**contrainte en base**) ». Mesuré :
  `lignes_bancaires` ne porte **AUCUNE contrainte CHECK**, et 0 ligne porte les deux. La garantie est
  tenue par l'APPLICATION — les quatre écrivains de BanqueTab posent l'un en annulant l'autre, et
  `planRapprochementAutomatique` ne rend jamais les deux — et le commentaire le dit maintenant.
  **Pourquoi elle n'est PAS portée dans la base** : `lignes_bancaires` est l'une des douze tables du
  socle (`supabase/schema/socle/`), donc la contrainte se retrouverait à la fois dans une migration
  et dans l'export du socle, **rejouée deux fois le jour d'une reprise** — c'est-à-dire un plan de
  reprise qui casse au moment où on s'en sert. Une passe à part, pas un ajout en passant.
  **TREIZE MUTATIONS, TOUTES MORDENT, et la DISCRIMINATION est le résultat** : la pastille de la
  LISTE et celle du PANNEAU font tomber UN test chacune, donc les deux copies sont gardées
  séparément — et il a fallu OUVRIR le panneau dans le test pour ça, une assertion restée sur la
  liste l'aurait laissé mentir tout seul. Le point de Checklist retiré et le point qui compte TOUS
  les mouvements font tomber un test chacun (les deux gardes symétriques). Les trois confirmations
  (`PiecesTab` en lot, `PieceFormModal` à l'unité, `CotisationsTab`) sont gardées une par une, et
  **l'alerte de lot TELLE QU'ELLE ÉTAIT** — la cause inventée — mord aussi.
  **Deux jeux d'essai ont été TYPÉS au passage, sans `as`** (`ligneDeTest` de BanqueTab, la fabrique
  de ChecklistTab) : le compilateur a sorti `created_at`, absent depuis toujours du premier. Même
  remède que les cinq colonnes du `piece()` de PiecesTab.
  **Et le faux client de BanqueTab n'annonçait pas de `count` sur `pieces`** : ses trois tests
  d'avant tournaient donc sur une lecture déclarée INCOMPLÈTE, avec le bandeau à la place de la
  liste — verts pour une raison qui n'était pas celle qu'ils annonçaient. C'est le coût récurrent de
  `lireTout`, et il se paie une fois par faux client.

- **ET LA MÊME CLÉ EN `ON DELETE SET NULL` FRAPPAIT UNE TROISIÈME FOIS — UN AMORTISSEMENT SANS
  JUSTIFICATIF SUR UNE 2035 SIGNÉE** (23/09/2026, trouvé en appliquant au chantier ci-dessus la
  règle qu'il invoquait : **chercher toutes les copies**). `pieces` a trois clés entrantes en SET
  NULL — `ecritures_brouillon.piece_id` (gardée par `rupturesPisteAudit` depuis longtemps),
  `lignes_bancaires.piece_id` (ci-dessus) et **`immobilisations.piece_id`, que personne ne
  regardait**.
  **`piece_id` NUL N'EST PAS UN ÉTAT LÉGITIME ICI, et c'est ce qui rend le contrôle sans
  ambiguïté** : `ImmobilisationsTab` n'a qu'UN chemin de création et il pose toujours
  `piece_id: piece.id` — une immobilisation naît d'une pièce validée, jamais d'une saisie libre.
  Un `piece_id` nul ne peut donc venir que de la suppression de cette pièce.
  **CE QUE ÇA COÛTE, et c'est pire que les deux précédents** : `calculerDeclaration2035` totalise
  `dotationPourAnnee` sur TOUTES les immobilisations sans regarder ce lien, donc la dotation part en
  **case CH d'une 2035 SIGNÉE** alors que le justificatif n'existe plus — et son fichier non plus.
  La piste d'audit ne peut rien en dire : elle part de l'écriture et du justificatif, et une
  immobilisation n'y a **aucune ligne**. Le registre, lui, affichait la colonne « Dotation
  annuelle » sans un mot sur le lien manquant.
  **LATENT, et mesuré** : 2 immobilisations en base, toutes deux rattachées.
  **ANNÉE-LIBRE DANS LE CONTRÔLE, CADRÉ SUR L'EXERCICE À CLÔTURE, et c'est la moitié qui se raconte
  mal** : un bien détaché l'est quelle que soit l'année, donc la Checklist le compte sur le dossier
  entier ; mais sa CONSÉQUENCE est datée — un bien amorti jusqu'en 2019 n'envoie plus rien en case CH
  de la 2035 de 2025, et le signaler là serait crier au loup sur le document qu'on signe. D'où le
  filtre `dotationPourAnnee(i, d.annee) > 0` **dans l'écran et pas dans le contrôle**.
  Trois écrans, comme `dotationsNonProratisees` dont c'est le précédent exact : pastille sur la ligne
  du registre, point « erreur » en Checklist (cible `immobilisations`), et carte chiffrée à Clôture,
  là où la déclaration se produit.
  **ET LES DEUX JEUX D'ESSAI DES ÉCRANS CONCERNÉS ÉTAIENT INFIDÈLES DE LA MÊME FAÇON** :
  `ImmobilisationsTab.test.tsx` et `ClotureTab.test.tsx` posaient tous deux `piece_id: null` **par
  défaut** — l'état que la production ne produit jamais. C'était INERTE tant que rien ne lisait ce
  champ, exactement comme le `devise: null` de `ChecklistTab` avant lui.
  **DIX MUTATIONS, TOUTES MORDENT — et les deux dernières n'ont mordu qu'après correction du TEST.**
  Remettre le défaut de fabrique à `null` laissait d'abord les 100 tests VERTS : les gardes
  symétriques passaient un `piece_id` EXPLICITE, donc le défaut n'atteignait aucune assertion et
  l'infidélité redevenait inerte. Une mutation qui ne mord pas accuse d'abord la mutation, puis le
  jeu d'essai — ici c'est le second. Les deux gardes s'appuient désormais sur le DÉFAUT de la
  fabrique, ce qui fait de la correction quelque chose de gardé plutôt que de seulement fait.
  Les huit autres : le contrôle qui ne mord jamais, celui qui mord toujours, le prédicat inversé, la
  ligne du registre TELLE QU'ELLE ÉTAIT, le point de Checklist retiré, le même comptant TOUT le
  registre, le cadrage sur l'exercice sauté (qui ne fait tomber que le test du bien déjà amorti), et
  la carte de Clôture retirée.

- **LA FAMILLE `ON DELETE SET NULL` EST CLOSE — LES TREIZE RELATIONS ADJUGÉES UNE PAR UNE**
  (23/09/2026). Les deux chantiers ci-dessus avaient été ouverts un par un ; s'arrêter là aurait
  laissé la question se reposer au prochain audit. Relevé dans `pg_constraint` : **13 clés en
  `SET NULL`**, et le critère est toujours le même — une fois le lien défait, **quelque chose
  AFFIRME-t-il une chose fausse que plus rien ne peut démentir ?**
  **CINQ colonnes étaient en faute, les cinq sont gardées** : `ecritures_brouillon.piece_id` et
  `.ligne_bancaire_id` par `rupturesPisteAudit` (de longue date), `lignes_bancaires.piece_id` et
  `.cotisation_id` par `mouvementsRapprochesSansObjet`, `immobilisations.piece_id` par
  `immobilisationsSansJustificatif` — les trois dernières le jour même.
  **LES HUIT AUTRES SONT BÉNIGNES, POUR TROIS RAISONS DISTINCTES — résultat négatif à garder, pour
  ne pas les réenquêter :**
  - **le vide devient VRAI** : `documents_divers.attached_to_cotisation_id` (le document repasse
    dans « documents non rattachés », ce qu'il est), `pieces.sous_dossier_id` (`sousDossierLabel`
    rend « — », soit « rangé nulle part », ce qu'il est — et **aucune suppression de sous-dossier
    n'existe dans l'application**, donc le geste ne peut pas se produire), `supplements.facture_id`
    (**lien facultatif par CONCEPTION**, vérifié dans l'écran plutôt que cru sur ce fichier :
    `facture_id: factureId || null`, on marque « facturée » sans facture).
  - **la colonne n'est AFFIRMÉE nulle part** : `agent_conversations.created_by`,
    `emprunts.created_by`, `emails_envoyes.envoye_par` et `.facture_id` — aucun écran ne les lit, et
    `types.ts` dit déjà « created_by n'est qu'un repère d'audit ».
  - **l'affirmation vient d'une AUTRE colonne, NOT NULL** : `piece_commentaires.auteur_id` —
    `FilCommentaires` affiche « Cabinet »/« Client » depuis `origine`, jamais depuis l'auteur.
  **ET LE MIROIR NO ACTION EST PROPRE LUI AUSSI** : le seul parent NO ACTION dont la suppression
  soit atteignable depuis un écran est `factures_emises` (`FacturesTab`), et son bouton est gardé
  sur `statut === 'brouillon'` — or un avoir naît VALIDÉ avec son numéro, donc `facture_origine_id`
  ne peut jamais bloquer et **la numérotation légale n'est pas exposée**. Les trois `created_by` que
  `sauvegarde.ts` déclare (`comptes_courants_associes`, `mouvements_cca`, `supplements`) sont en
  NO ACTION et non en SET NULL : ils BLOQUENT au lieu de détacher, donc du côté sûr.
  **DEUX ASYMÉTRIES RELEVÉES, aucune atteignable aujourd'hui, écrites pour le jour où elles le
  deviendront** : `pieces.sous_dossier_id` est en SET NULL quand `documents_divers.sous_dossier_id`
  est en NO ACTION — **la même relation depuis deux tables sœurs, avec des comportements opposés**,
  donc le jour où « Supprimer ce sous-dossier » existera, il réussira ou échouera selon ce qu'il
  contient et personne ne s'y attendra. Et retirer un membre du cabinet ne supprime PAS ses
  `dossier_assignations` : la confirmation dit vrai — `admin_du_dossier` EXIGE une ligne
  `cabinet_admins` (vérifié dans la définition de la fonction en base, pas supposé), donc l'accès
  est bien coupé — mais **le réinscrire lui rendrait en silence ses anciens dossiers**. Mesuré :
  0 assignation, 0 membre d'équipe ; la fonctionnalité n'a jamais été exercée, et trancher serait
  une décision produit, pas une correction.
- **ET LA CONFIRMATION DE RETRAIT D'UNE IMMOBILISATION PROMETTAIT UNE PIÈCE QUI N'EXISTE PLUS**
  (23/09/2026, queue du chantier ci-dessus — « chercher toutes les copies » appliqué à mon propre
  travail du jour). « Retirer cette immobilisation ? **La pièce redevient une charge courante
  ordinaire.** » suppose qu'il RESTE une pièce. Sur une immobilisation dont le justificatif a été
  supprimé — l'état que `immobilisationSansJustificatif` venait de faire signaler, et dont l'action
  recommandée par la Checklist EST ce bouton — la phrase est fausse, **et elle rassure à l'envers** :
  rien ne redevient une charge, et le retrait efface la DERNIÈRE trace comptable de la dépense
  (plus de pièce, donc plus d'amortissement non plus). L'opérateur qui suit le conseil de mon propre
  contrôle lisait un mensonge. Le message nomme désormais ce qui se passe vraiment.
  Même famille que l'alerte de `PiecesTab` corrigée le même jour, qui inventait une cause de blocage
  impossible : **une mise en garde se vérifie contre ce que le code FAIT, pas contre ce qu'elle a
  voulu dire.**
  **Trouvé par un balayage des VINGT-SIX confirmations de `src/`, et c'était la seule en faute —
  résultat négatif à garder.** Les vingt-cinq autres disent vrai, y compris les cinq qui portent une
  promesse VÉRIFIABLE : « et tous ses mouvements » (`mouvements_cca` est bien en CASCADE), « le
  brouillon de facture » (bouton gardé sur `statut === 'brouillon'`), « son compte de connexion
  n'est pas supprimé » (aucun `auth.admin.deleteUser` dans tout le dépôt), « la synchronisation ne
  sera plus possible », et « personne ne pourra plus le lire » (`piece_commentaires` n'a aucune
  policy `UPDATE`).
  **Le balayage doit lire les confirmations MULTI-LIGNES** : une extraction par littéral simple n'en
  rend que quinze sur vingt-six, et la fautive de la veille était justement coupée sur trois
  lignes — **neuvième fois que ce dépôt se ferait prendre par un retour à la ligne**.
  **Quatre mutations mordent, et la DISCRIMINATION est le résultat** : le code TEL QU'IL ÉTAIT n'en
  fait tomber qu'UNE, celle écrite pour lui ; la condition inversée en fait tomber DEUX, avec le
  garde symétrique sans lequel « la confirmation dit le cas détaché » serait satisfait par un écran
  qui annoncerait TOUJOURS la disparition de la dépense ; et la phrase fausse simplement AJOUTÉE à
  la nouvelle est attrapée à part — c'est elle le défaut, pas l'absence de la nouvelle.
  **Le motif « filtre de période sur une colonne NULLABLE » est désormais borné par le SCHÉMA et
  non par un grep** : sur les quatre colonnes filtrées en `gte`/`lte` dans le code (`date_piece`,
  `date`, `echeance`, `created_at`), `pieces.date_piece` est la SEULE nullable — toutes les autres
  sont NOT NULL (vérifié dans `information_schema.columns`). Il n'y a donc que deux sites possibles,
  et tous deux sont traités.
- **UN « TOTAL PRÉLEVÉ » QUI SOMMAIT DES VALEURS ABSOLUES** (23/09/2026, `VirementsTab` — le dernier
  écran à logique propre qu'aucune session n'avait ouvert). Le bouton « Virement personnel » de
  l'onglet Banque n'est borné par AUCUN signe, et c'est le seul qui nomme la situation d'un mouvement
  venu du compte personnel de l'exploitant : un APPORT marqué ainsi faisait **MONTER** le total au
  lieu de le réduire. 1 000 € sortis et 300 € entrés affichaient « Total prélevé 1 300,00 € ».
  **LE SIGNE SE PERD DANS LE TOTAL, ET NULLE PART AILLEURS** : la ligne rend `formatMoney(montant)`,
  donc l'entrée s'y voit ; c'est le total qui l'absorbe — et un total faux a exactement l'air d'un
  total, la ligne fautive étant noyée dans une liste.
  **LATENT, et mesuré** : 3 lignes marquées en base, **toutes des sorties** (net −7 500 €, somme des
  valeurs absolues 7 500 € — identiques), 0 au statut inattendu, 0 portant un lien. Le correctif ne
  change donc aucun chiffre existant.
  **ON NE TRANCHE PAS CE QU'EST UN APPORT** : le distinguer vraiment (compte 108 de l'exploitant
  porte les deux sens) serait une décision produit, pas une correction. On l'écarte d'un total qui ne
  le désigne pas, et on le DIT — la mention étant **rendue vide quand elle n'apprend rien**, comme
  `dotationsNonProratisees` et `reserveSurMoyenne`.
  **Le calcul reste DANS l'écran, et c'est écrit plutôt que laissé deviner** : une partition par
  signe n'est pas une règle métier et ne duplique rien de `src/lib` (le balayage du 21/09/2026 sur
  les calculs définis dans les écrans vaut pour les fonctions LONGUES, pas pour deux `filter`). Le
  test d'écran garde donc le calcul ET le câblage ensemble.
  **Cinq mutations, toutes mordent, et la DISCRIMINATION est le résultat** : le code TEL QU'IL ÉTAIT
  et la mention retirée tombent chacun sur le test écrit pour eux ; la partition inversée en fait
  tomber DEUX ; la mention affichée TOUJOURS ne touche que le garde symétrique ; et le montant
  annoncé pris sur les sorties est attrapé à part — sans quoi « l'écran nomme l'apport » serait
  satisfait par un écran qui en annonce un autre.
  **Résultat négatif du même passage, à garder** : le reste de `VirementsTab` est juste — lecture
  paginée, total qui échappe à la recherche, bandeau de lecture partielle, et `retirer` qui écrit la
  même transition que son jumeau de `BanqueTab` (les `piece_id`/`cotisation_id` qu'il ne remet pas à
  null sont déjà nuls par construction, le marquage les ayant effacés). Ne pas le réenquêter.
- **LES LECTURES D'UNE SEULE LIGNE N'ONT PAS DE SCANNER, ET N'EN ONT PAS BESOIN** (balayage du
  23/09/2026, résultat négatif à garder). Six scanners gardent les lectures de COLLECTION — compte
  annoncé, erreur lue, drapeau signalé, tri total, de part et d'autre de `src/` ; les **39** lectures
  d'UNE ligne (`.single()`, `.maybeSingle()`, `.limit(1)`) n'étaient couvertes par aucun, ce qui
  avait tout l'air d'un trou de la même famille que les cinq demi-chemins déjà payés ici.
  **Ce n'en est pas un, et pour deux raisons distinctes** : les deux `.limit(1)` sont des tests
  d'EXISTENCE (`appartientDejaAuCabinet`, dans ses deux copies), donc l'absence de tri n'y décide de
  rien — c'est « est-ce les BONNES lignes ? » posé à une lecture qui n'en veut aucune en
  particulier ; et tout le reste est déjà gardé par les scanners d'ERREUR, **« qui prend `data` prend
  `error` » valant pour une ligne comme pour mille**.
  **Un seul point relevé, et il n'est pas producible** : `FactureApercu` rend `numeroOrigine ?? '…'`,
  donc la MÊME ellipse pour « en cours de chargement » et pour « lu, mais absent », sur un AVOIR
  imprimé qui part au client. La branche ERREUR est bien traitée (`'— non lu'`, corrigée en son
  temps), et `factures_emises.facture_origine_id` est en NO ACTION avec un bouton de suppression
  gardé sur `statut === 'brouillon'` alors qu'un avoir naît VALIDÉ : la ligne d'origine ne peut pas
  disparaître. Noté pour ne pas le réenquêter.
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
- **ET CETTE RÈGLE-LÀ N'ÉTAIT GARDÉE PAR RIEN, APRÈS AVOIR ÉTÉ PAYÉE TROIS FOIS** (21/09/2026).
  `capitalRestantDu`/`empruntActif` ci-dessus, la période par défaut d'un pack, `toIsoDate` — trois
  occurrences, trois corrections, zéro contrôle. Elle vivait dans ce fichier et dans les fonctions de
  `lib/format.ts` faites pour elle (`aujourdHuiSql`, `premierJourDuMoisCourant`, `ajouterMois`,
  `ajouterJours`), c'est-à-dire nulle part où une rechute se verrait.
  **LE SIGNAL MÉCANIQUE N'EST PAS `toISOString()`, C'EST SA TRONCATURE**, et c'est ce qui rend le
  balayage possible sans arbitrage : gardé ENTIER, `new Date().toISOString()` est un INSTANT, donc
  légitime — un `created_at`, un `updated_at`, un `validated_at`, et ce dépôt le fait neuf fois à bon
  droit. C'est le `.slice(0, 10)` (ou `.substring`, `.substr`, `.split('T')[0]`) qui en fait une date
  CIVILE, prise dans le fuseau du serveur et non dans celui de qui regarde.
  **Six troncatures, DEUX en faute :**
  - `tauxChange.montantsPourPiece` — le taux du jour d'une pièce dont l'OCR n'a pas lu la date.
    La pièce est convertie au taux de la VEILLE entre minuit et 2 h du matin à Paris, et **pendant
    toute la matinée à l'est de Greenwich**. Le montant part en comptabilité sans que rien ne le
    distingue d'une conversion juste : le taux enregistré est un VRAI taux BCE, simplement pas celui
    du bon jour. Aucun test n'exerçait ce repli — les quatre cas existants passaient tous une date
    explicite, exactement l'angle mort décrit ci-dessus.
  - `agent-comptable` — la « Date du jour » donnée au modèle « pour interpréter cette année, l'an
    dernier ». Une Edge Function tourne en UTC : un jour d'écart déplace la PÉRIODE d'une réponse, et
    le 1er janvier au petit matin c'est l'EXERCICE ENTIER, sur un assistant dont tout le prompt exige
    des montants exacts et la période concernée. Le fuseau du cabinet est désormais ÉCRIT
    (`Europe/Paris`, via `formatToParts` — c'est le séparateur qui varie d'une locale à l'autre, pas
    les composantes) : la fonction ne reçoit rien qui dise où se trouve son appelant, et cette
    application est française de bout en bout.
  **Les quatre autres sont légitimes, et la raison est toujours l'une de deux** : une `Date` ANCRÉE
  en UTC de bout en bout (`${date}T00:00:00Z` puis `setUTCDate` — `dateMoinsJours` et son jumeau
  auto-porté de `taux-change-bce`), ou une borne dont l'écart de fuseau est COUVERT par une marge
  écrite pour lui (`dateFuture`, son jour de marge).
  **L'EXCEPTION PORTE UN NOMBRE, PAS SEULEMENT UNE RAISON**, et c'est le point de conception :
  dispenser un FICHIER dispense tout le fichier — or le premier dispensé est justement `tauxChange.ts`,
  où le défaut vivait à deux lignes de la troncature légitime. Une rechute y serait passée sans un mot.
  Le compte doit tomber juste : une de plus est une rechute, une de moins est une raison morte.
  **Sept mutations mordent** (`datesUtc.test.ts`), dont chacun des deux défauts replanté et le
  scanner ramené à la lecture « par ligne » — le piège qui a déjà aveuglé **quatre** balayages de ce
  dépôt, et contre lequel une source synthétique porte la faute coupée sur trois lignes.
  **ET « IRRÉDUCTIBLEMENT INVISIBLE SOUS `TZ=UTC` » ÉTAIT FAUX — DÉMENTI PAR L'EXÉCUTION LE JOUR
  MÊME.** Il était écrit ici que la mutation du repli de taux ne mord pas sous UTC, que « aucune
  écriture de test n'y changera rien », et que `npm run test:fuseaux` portait seul cette garantie.
  La prémisse était juste — les deux implémentations sont bien identiques sous UTC — et la
  conclusion ne l'était pas : elle supposait qu'un test SUBIT le fuseau du runner. **Node relit
  `process.env.TZ` à chaque opération de date**, donc un test le CHOISIT. `tauxChange.test.ts`
  balaie désormais Europe/Paris, UTC, America/Martinique et Pacific/Auckland qu'il pose lui-même, et
  la mutation mord sur le runner GitHub. Écrit par relecture, corrigé par exécution — comme la
  phrase sur `parseDate` plus haut.
  **Et la borne de ce test a dû être gardée à son tour** : ramener la liste au seul UTC laissait tout
  vert, la boucle de vérification tournant alors ZÉRO fois. Une garde qui ne s'exécute pas est
  indiscernable d'une garde qui passe.
  **`agent-comptable` déployée en version 18** le 21/09/2026 — `verify_jwt` relu et repassé à `false`,
  déployé comparé au dépôt AVANT écrasement (identique au caractère près, donc rien à embarquer au
  passage), aller-retour après : zéro différence résiduelle sur 661 lignes.
- **ET LA MÊME RÈGLE, PRISE PAR L'AUTRE BOUT : L'AFFICHAGE. UNE DATE CIVILE N'A PAS DE FUSEAU, ET
  `formatDate` LUI EN DONNAIT UN** (21/09/2026). Le balayage précédent visait l'ÉCRITURE d'une date
  (`toISOString().slice(0, 10)`) ; celui-ci vise sa LECTURE. `formatDate` — la fonction qui affiche
  chaque date de l'application, **cinquante appels, dont quarante-cinq sur une colonne `date` de
  Postgres** (mesuré en croisant les appelants avec `information_schema.columns` : la séparation est
  nette, tout le reste étant `created_at`, `occurred_at` ou `generated_at`) — faisait
  `new Date(value).toLocaleDateString('fr-FR')`. Or `new Date('2026-01-01')` est MINUIT UTC :
  replacée dans le fuseau de qui regarde, elle recule d'un jour dès que le décalage est négatif.
  **LE DÉFAUT ÉTAIT ÉCRIT EN TOUTES LETTRES TROIS LIGNES PLUS BAS**, dans le commentaire
  d'`anneeDe` : « à New York, ce 1er janvier se lit 31 décembre 2025. Tant que les utilisateurs sont
  en France le résultat est juste par chance, pas par construction ». Ce commentaire explique la
  distinction civile/instant sur dix lignes pour ses voisines, pendant que la fonction juste au-dessus
  de lui la piétinait. Même forme que `chargerCommentaires`, dont la mise en garde vivait au-dessus
  d'un code qui jetait le drapeau permettant de la voir.
  **ET « LES UTILISATEURS SONT EN FRANCE » NE PROTÈGE PAS, C'EST LÀ QUE LA PRÉMISSE CASSE** : la
  Guadeloupe, la Martinique, la Guyane, Saint-Pierre-et-Miquelon et la Polynésie SONT la France, et
  une profession de santé y est exactement la clientèle de cette application. **Mesuré** : sur ces
  cinq fuseaux, une pièce du 01/01/2026 s'affiche 31/12/2025 — l'EXERCICE PRÉCÉDENT — pendant que
  Clôture, la 2035 et le FEC la comptent dans le bon. La Réunion, Mayotte et la Nouvelle-Calédonie,
  à l'est, sont indemnes.
  **ON NE ROUTE PAS PAR APPELANT, LA VALEUR DIT CE QU'ELLE EST** : PostgREST rend une colonne `date`
  en `AAAA-MM-JJ` nu et un `timestamptz` avec son heure. `formatDate` discrimine donc sur la FORME de
  ce qu'elle reçoit, reste juste pour les deux, et **un appelant ajouté demain est juste par
  construction** — là où une règle à appliquer site par site attend seulement son prochain oubli
  (c'est « un piège qu'un nom supprime vaut mieux qu'un piège gardé par un contrôle », appliqué à la
  forme de la donnée). Une valeur que `Date` ne sait pas lire est rendue TELLE QUELLE : c'est ainsi
  qu'un `+012345-01` écrit par une extraction fautive se voit, au lieu d'être remplacé par une date
  plausible.
  **LA COPIE DE `send-email` EST CORRIGÉE DANS LA FOULÉE** — chercher toutes les copies avant de
  corriger la première. Elle est LATENTE (le runtime des Edge Functions est en UTC, donc le libellé
  se retrouve par accident de runtime) mais porte `date_emission` et `date_echeance` d'une facture
  **envoyée au client**, et rien ne le dirait une fois l'e-mail parti. `SuperAdminPage`, dont le
  `new Date(created_at).toLocaleDateString` est désormais exactement ce que `formatDate` fait,
  rejoint le point unique. Déployée en **version 3**, `verify_jwt` relu et repassé à `false`, déployé
  comparé au dépôt AVANT écrasement (identique au caractère près), aller-retour après : zéro
  différence résiduelle sur 228 lignes.
  **LES TESTS CHOISISSENT LEUR FUSEAU**, et c'est ce qui décide de ce qu'ils gardent : sous
  Europe/Paris comme sous UTC le défaut est rigoureusement invisible, donc un test écrit normalement
  serait resté vert avec le défaut entier. C'est la découverte qui a aussi corrigé la phrase
  « irréductiblement » ci-dessus.
  **`datesAffichees.test.ts` fait de la règle un contrôle**, parce qu'elle vivait dans un commentaire
  et n'a pas suffi. Il part de TOUTE source de `src/` et de `supabase/functions/`, interdit
  `new Date(<valeur>).toLocale…String(` et n'admet que des exceptions écrites portant leur raison —
  trois, toutes des INSTANTS démontrés (`dateRelative` et ses trois appelants, l'horodatage d'une
  sauvegarde, le repli de `send-email`). `new Date()` SANS argument reste libre : c'est « maintenant »,
  jamais une date civile.
  **SA BORNE A MORDU À LA PREMIÈRE EXÉCUTION, et c'est la CINQUIÈME fois que ce dépôt se fait prendre
  par la portée d'une expression régulière** : avec un `[\s\S]*?` nu, un `new Date(valeur)` de calcul
  en haut d'un fichier se raccorde au `.toLocaleDateString(` d'un `new Date()` parfaitement légitime
  cent lignes plus bas — `DossiersList.tsx` ressortait en faute sans l'être. Le corps ne peut donc pas
  enjamber un `new Date(`, réparation identique à « un corps s'arrête au `.from(` SUIVANT ».
  **ET UN SCANNER QUI COMPTE NE PEUT PAS GARDER `send-email`** — dit plutôt que laissé croire :
  replanter le défaut y laisse le compte à UN, la même occurrence devenant le seul chemin au lieu
  d'un repli. Vérifié par mutation, qui a SURVÉCU. Ce qui la garde est donc le garde-fou habituel des
  fonctions auto-portées : lire la vraie source, en extraire `formaterDate` et l'EXÉCUTER — sous des
  fuseaux choisis là aussi, pour ne pas dépendre de l'accident de runtime.
  **Et les deux copies s'évaluent contre une TABLE écrite dans le test, jamais l'une contre l'autre** :
  `expect(deployee(iso)).toBe(formatDate(iso))` reste vert si l'on remplace le second appel par le
  premier — la comparaison devient une tautologie, exactement l'aveuglement trouvé le même jour sur
  `agentComptableAnalyse`. Une référence extérieure aux deux copies ne peut pas s'effondrer ainsi.
  Neuf mutations mordent en tout.
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
  **ET IL N'EST PLUS UNE RECETTE À REFAIRE DE MÉMOIRE : c'est `supabase/essais/allerretour.py`**
  (21/09/2026), rejoué d'une commande — `python3 supabase/essais/allerretour.py <id> <chemin>
  [marqueur]`. Il retrouve le journal de la session en cours tout seul, applique le décodage
  `\uXXXX` à la source du dépôt et rend « zéro différence résiduelle sur N lignes ». Le `marqueur`
  facultatif est ce qui l'empêche de mentir : **sans lui, le journal porte encore les lectures
  ANTÉRIEURES de la même fonction**, et l'aller-retour comparerait le dépôt à la version qu'on vient
  de remplacer — vert pour une raison fausse. Lui aussi est éprouvé par mutation (une ligne changée,
  un accent changé, un marqueur introuvable : les trois virent au rouge), parce qu'un harnais qui
  ment est pire qu'un harnais absent.
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
  **ET IL Y A UN TROU PLUS FIN QUE « LA POLICY », NOMMÉ LE 21/09/2026 PARCE QUE LA BASCULE DE MODÈLE
  VENAIT D'Y PASSER** : une policy IAM cadre une action par RESSOURCE, et ce test ne compte que des
  ACTIONS. Changer de modèle Bedrock laisse l'action rigoureusement identique — `bedrock:InvokeModel`
  des deux côtés — tout en changeant l'ARN visé. Une policy restreinte à un modèle refuserait donc le
  nouveau **avec un test VERT** : exactement la forme du défaut que ce garde-fou existe pour
  empêcher, revenu par la porte que sa liste d'actions ne regarde pas.
  **La bascule Sonnet 4.6 → Haiku 4.5 n'a été couverte que PAR CHANCE**, et le dire vaut mieux que de
  s'en féliciter : le harnais de mesure avait appelé Haiku avec les MÊMES identifiants AWS et dans la
  MÊME région que la production, donc un refus IAM s'y serait montré d'abord. C'est une raison de
  plus de garder ce harnais aligné sur la production plutôt qu'une commodité.
  **Règle qui en découle : changer de modèle demande un APPEL RÉEL avec les identifiants de la
  production, jamais un test vert.** Aucun contrôle de ce dépôt ne peut s'y substituer — c'est le
  même couple « une moitié gardée par le code, l'autre par une vérification » que partout ailleurs
  sur AWS, avec une frontière simplement plus fine qu'annoncé jusqu'ici.
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
- **ET CE CONTRÔLE-LÀ NE COUVRAIT QUE `src/` : LES EDGE FUNCTIONS N'AVAIENT JAMAIS RENCONTRÉ DE
  COMPILATEUR** (22/09/2026). `tsconfig.app.json` n'inclut que `src`, `tsconfig.node.json` que
  `vite.config.ts` : **4 419 lignes réparties sur quatorze fonctions n'étaient type-vérifiées par
  RIEN**, et le déploiement ne l'est pas non plus — il regroupe, il ne contrôle pas. Cinquième
  membre de la famille « le balayage s'était arrêté à `src/` », et le seul qui porte sur un OUTIL
  plutôt que sur un motif.
  **LA COUCHE QUI MANQUAIT EST NOMMÉE DANS CE FICHIER DEPUIS LA VEILLE.** Il y est écrit que les
  trois gardes d'un drapeau de lecture partielle ne se recouvrent pas : « le scanner voit qu'on
  CALCULE le drapeau, le compilateur qu'il est LU, le test d'écran qu'il ATTEINT l'opérateur ».
  Côté `src/`, `noUnusedLocals` tient la deuxième. Côté Edge Functions, personne — donc ceci passait
  sans un mot :

  ```ts
  const lecture = await lireTout(...)
  const incomplet = !lecture.complete   // le drapeau EST lu → `lecturesSignalees` reste VERT
  ...                                   // et `incomplet` n'atteint rien
  ```

  **Aucun scanner de texte ne peut voir ça** — la liaison est bien couverte, le drapeau bien lu.
  Seul un compilateur sait qu'une valeur calculée ne va nulle part. C'est le cas d'essai central
  d'`edgeFunctionsCodeMort.test.ts`, et la mutation qui le plante dans `agent-comptable` fait tomber
  cinq des six tests.
  **CE QUI EST GARDÉ EST LE CODE MORT, ET RIEN D'AUTRE — l'arbitrage est écrit plutôt que tu.** Les
  diagnostics de code mort (variable, import, paramètre, ligne inatteignable, `switch` qui déborde)
  sont **VERTS sur les 4 419 lignes**, donc le garde se pose sans toucher une ligne de production ni
  redéployer quoi que ce soit — et c'était la condition pour qu'il se pose du tout. Le typage
  COMPLET, lui, rend **53 erreurs** sous les réglages par défaut de TypeScript 6.0.3 (qui active
  `strict`) et **26** en le désactivant. **Aucune des 26 n'est un défaut** : elles se répartissent
  entre les SDK tiers non installés et le générique `Uint8Array` de la lib DOM. Les fermer
  demanderait d'installer cinq SDK que `package.json` ne porte pas — payé par chaque `npm ci` de la
  CI — ou de tenir une LISTE de noms de types à la main, c'est-à-dire la liste d'inclusion dont ce
  dépôt connaît la panne sous cinq autres noms ; et corriger les sources demanderait sept
  redéploiements avec leurs `verify_jwt`, leurs comparaisons avant écrasement et leurs
  allers-retours. **C'est mot pour mot l'arbitrage des huit ternaires interdits, et il penche du
  même côté** : on garde ce qui est vrai et vérifiable, on NOMME le reste plutôt que de promettre
  « les Edge Functions sont type-vérifiées ».
  **LE VRAI TYPAGE DE `supabase-js` A ÉTÉ ESSAYÉ PUIS ÉCARTÉ SUR MESURE**, et ce n'est pas un
  renoncement de confort : c'est le seul des sept modules qui SOIT installé, donc le candidat
  évident. Branché sur ses vrais types, `.from('cabinets').select(...)` rend des lignes de type
  `never` faute de type `Database` généré — soit **15 erreurs sur du code juste**, dont
  « `limite_ia_alerte_usd` n'existe pas sur `never` ». Le typage réel ne vaut donc qu'avec un schéma
  généré tenu à jour, ce qui est un autre chantier ; le brancher à moitié produirait du BRUIT, et un
  avertissement qui se trompe finit par ne plus être lu.
  **ET J'AI CRU TROUVER UN VRAI DÉFAUT — C'ÉTAIT MA PROTHÈSE.** Le premier passage signalait
  `'page' is possibly 'undefined'` dans la boucle de sondage d'`extract-piece`, c'est-à-dire
  exactement le chemin dont ce fichier dit que 92 % d'un document y partiraient en silence.
  Vérifié : `textract.send` étant shimmé en `any`, assigner `any` à un `let` déclaré
  `DetectionResult | undefined` **re-narrow au type DÉCLARÉ**, `undefined` compris. Le code est
  juste ; c'est la prothèse qui parlait. Mesure qui corrige une attente plutôt qu'un défaut — et la
  raison pour laquelle un garde de typage à moitié branché est dangereux.
  **RÉSULTAT NÉGATIF MESURÉ AU PASSAGE, à garder pour ne pas le refaire** : `lecturesSignalees` voit
  bien les **12 sites `lireTout` des Edge Functions** (11 dans `agent-comptable`, 1 dans
  `superpdp-sync`) — donc il ne s'était PAS arrêté à `src/`, contrairement à ce que le motif laissait
  craindre — et les 12 lisent leur drapeau **et l'AGISSENT** : refus 404, message d'erreur au modèle,
  interruption de la synchronisation. Le côté Edge était sain sur ce motif alors même qu'il n'avait
  qu'une couche de garde.
  **Les options ne sont PAS retapées dans le test : il LIT `tsconfig.edge.json`**, qui est la source
  unique — deux copies d'un réglage finissent par diverger, et celle qui dériverait ici ferait passer
  le test pour un contrôle tenant une barre que personne ne tient. Une mutation le prouve (retirer
  `noUnusedLocals` du fichier de config fait tomber trois tests). Ce tsconfig n'est **pas** référencé
  par `tsconfig.json` : `tsc -b` doit rester le contrôle de `src/`, qui est propre.
  **Sept mutations, toutes mordent, et la DISCRIMINATION est le résultat** : le défaut d'origine
  planté dans une vraie fonction en fait tomber cinq ; le balayage pointé sur le mauvais dossier n'en
  fait tomber qu'UNE, le plancher — c'est-à-dire la seule chose qui distingue « zéro faute »
  d'« aveugle » ; `allowUnreachableCode` et la mise en cache des sources virtuelles n'en font tomber
  qu'une chacune, celle écrite pour elles. La règle du cache est donc PORTANTE plutôt qu'affirmée en
  commentaire : sans elle, un second appel sur un même chemin virtuel rendrait le verdict du
  premier — vert pour une raison fausse.
- **ET TROIS SCANNERS DISPENSAIENT UN FICHIER LÀ OÙ LA DOCTRINE EXIGE UN NOMBRE — LES TROIS ÉTAIENT
  AVEUGLES, MESURÉ** (22/09/2026). La règle est écrite ici depuis le 21/09/2026 sous `datesUtc` :
  « L'EXCEPTION PORTE UN NOMBRE, PAS SEULEMENT UNE RAISON », parce que dispenser un FICHIER dispense
  aussi les sites CORRECTS qu'il porte. Elle avait été appliquée à `datesUtc`, `datesAffichees`,
  `lecturesVerifiees`, `edgeFunctionsLectures`, `edgeFunctionsPaginees` — et **pas** à `apercu`,
  `retraitsStockage` ni `lecturesPaginees`. Ce fichier le notait comme « latent, un site chacun » ;
  latent n'est pas gardé.
  **La preuve est une plantation, pas un raisonnement** : un second `window.open` dans `apercu.ts`,
  un second `.storage…remove(` dans `stockage.ts`, une seconde lecture nue de `taux_change_bce` dans
  `tauxChange.ts` — **les trois scanners restaient ENTIÈREMENT VERTS** (0 test tombé sur 9, 11 et 5).
  Après conversion, les trois mordent. Ce n'est donc pas un durcissement de principe, c'est un trou
  mesuré et refermé.
  **`lecturesPaginees` méritait la conversion autant que les deux autres**, alors que sa clé est
  déjà plus fine qu'un nom de fichier (`chemin [table]`) : deux lectures nues de la MÊME table dans
  le MÊME fichier restent indiscernables, et les dix dispensées portent justement une lecture
  légitimement bornée — c'est-à-dire l'endroit exact où la seconde se glisserait.
  **`retraitsEnDirect` a dû changer de contrat, et c'est la moitié du correctif qui se raconte
  mal** : il consultait la liste d'exceptions LUI-MÊME et rendait `[]` pour un fichier dispensé. Une
  fonction qui rend `[]` ne peut pas dire COMBIEN elle a vu, donc aucun compte ne lui était
  comparable. Le détecteur COMPTE, l'appelant DISPENSE — et un test synthétique porte la règle (un
  fichier dispensé pour un retrait qui en porte deux est en faute).
  **Neuf mutations, toutes mordent** — pour chacun des trois : le site en trop planté dans le
  fichier dispensé, le compte menti d'une unité, et l'exception INVENTÉE.
  **ET J'AI PERDU LES TROIS CONVERSIONS EN COURS DE ROUTE, PAR UNE VARIANTE PLUS TRANCHANTE D'UN
  PIÈGE DÉJÀ PAYÉ DEUX FOIS ICI.** Ce fichier met en garde contre `git checkout --`, qui restaure
  depuis l'INDEX et emporte un correctif non commité. Le remède qu'on en tire naturellement est
  « indexer avant de muter » — et il ne suffit pas : **`git checkout HEAD -- <chemin>` réécrit AUSSI
  L'INDEX**. Le harnais qui remettait un test à sa version d'avant pour prouver l'aveuglement a donc
  pollué l'index, et le `git checkout -- .` final a restauré la version d'AVANT dans les trois
  fichiers. **La suite est restée VERTE à 1 427** — plus courte, jamais rouge : exactement le
  symptôme déjà décrit (« Il se voit au COMPTE de tests, pas au vert »). La règle qui vaut est donc
  plus forte que celle écrite jusqu'ici : **une modification non commitée se copie HORS du dépôt
  avant tout harnais qui manipule git**, l'index n'étant pas un abri.
- **UNE PHRASE QUI ANNONÇAIT SON PROPRE TEST, ET LE TEST N'EXISTAIT PAS** (22/09/2026). Ce fichier
  pose que la famille « une mise en garde écrite au-dessus d'un code qui ne la tient pas » **se
  cherche en lisant les COMMENTAIRES plutôt que le code**. Prise dans sa forme la plus mécanique —
  les commentaires qui AFFIRMENT qu'un test garde quelque chose, donc une affirmation vérifiable
  donc réfutable — elle rend **six** affirmations dans les sources de production. **Cinq tiennent**
  (`cases2035` ×2, `baremeKilometrique`, `ratiosBancaires`, `BanqueTab`), et la sixième ne trouvait
  rien.
  **`liensPerdus` (sauvegarde.ts) compare sur `id`**, et son en-tête explique pourquoi c'est
  correct : « une clé étrangère d'une seule colonne ne peut viser qu'une clé primaire d'une seule
  colonne : toutes les tables PARENTES du graphe ont donc `id`. **Un test le vérifie**, pour que le
  jour où ce ne serait plus vrai se voie ici. » Il n'a jamais existé.
  **LE DÉGÂT EST BRUYANT, PAS SILENCIEUX, et c'est dit plutôt que dramatisé** — cette famille est
  d'habitude l'inverse. Un parent sans colonne `id` ferait rendre `Set {"undefined"}` à
  `identifiants`, donc déclarerait perdue CHAQUE ligne fille, et `restaurerSauvegarde` REFUSE sur un
  lien perdu : ce n'est pas une restauration fausse, c'est une restauration IMPOSSIBLE, bloquée par
  des centaines de liens qui ne sont pas cassés, au moment précis où l'on restaure. PLAN_DE_REPRISE.md
  décrit exactement ce terrain-là comme celui dont on découvre les défauts trop tard.
  **L'INVARIANT TIENT — 11 parents, aucun à clé composite.** Le chantier ne corrige donc rien : il
  rend vraie une phrase qui était fausse. Ce qui le justifie est la relation qu'on ajoutera demain
  vers l'une des six tables à clé non-`id` (`cabinet_admins`, `facture_numerotation`,
  `previsionnels_bancaires`, `super_admins`, `superpdp_credentials`, `taux_change_bce`), et qu'aucun
  signal n'attraperait.
  **LA SOURCE EST LE SCHÉMA EXPORTÉ, PAS `CLES_PRIMAIRES`** — sans quoi le garde reposerait sur la
  liste d'inclusion tenue à la main qu'il est censé contrôler, et ce dépôt connaît cette panne sous
  cinq noms. Le test DÉRIVE la clé primaire de chaque table du SQL, comme `sauvegardeTables` en
  dérive la liste des tables.
  **ET LES `ALTER` DOIVENT SE REJOUER — mesuré, sans eux la dérivation est FAUSSE sur deux tables** :
  `piece_textes_ocr` (créée avec `primary key` sur `piece_id`, passée à un `id` de substitution par
  `alter table … add column id … primary key`) et `facture_numerotation` (passée de deux à trois
  colonnes par `drop constraint` + `add primary key`). C'est la quatrième forme de « un export de
  schéma n'est pas un schéma » : ici ce n'est pas une table qui manque, c'est une instruction
  POSTÉRIEURE que la lecture naïve ignore. Quatre instructions dans tout le schéma, deux formes,
  rejouées dans l'ordre des fichiers puis des instructions.
  **L'ACCORD AVEC LA BASE EST EXACT, et il a été vérifié par une requête plutôt que supposé** :
  `pg_constraint` rend 41 tables et six clés non-`id`, et la dérivation les rend **colonne par
  colonne**. C'est ce qui permet au test de comparer `CLES_PRIMAIRES` au schéma **dans les deux sens
  et sans AUCUNE exception** — une de moins serait une table paginée sur un `id` inexistant, une de
  plus une raison morte. Ce que le test ne peut pas garder, annoncé comme partout ailleurs : que le
  fichier exporté décrive la base réelle. Couple habituel — une moitié gardée par le code, l'autre
  par une vérification, faite ce jour-là.
  **La sixième affirmation, elle, était au FUTUR** (`BanqueTab` : « et un test qui le figera ») alors
  que le test existait déjà. Inoffensif, et corrigé quand même : une promesse au futur ne se vérifie
  pas en la lisant, donc elle ne se distingue pas d'une promesse jamais tenue — c'est précisément ce
  qui a laissé vivre la sixième. Les deux commentaires NOMMENT désormais leur fichier de test.
  **Huit mutations, et la septième a d'abord SURVÉCU** : retirer le tri par position ne changeait
  rien, l'ordre des expressions régulières coïncidant par ACCIDENT avec l'ordre textuel de tous les
  fichiers réels. Une mutation qui ne mord pas accuse d'abord le jeu d'essai — un cas SYNTHÉTIQUE
  (une table qui reçoit un `id` de substitution puis qu'on re-clé) sépare les deux ordres, et le tri
  redevient portant. Les sept autres : la relation fautive plantée vers une table composite, les
  trois mensonges possibles de la liste (une de moins, une inventée, les mauvaises colonnes), les
  `alter` non rejoués, les `drop table` non rejoués, et le lecteur pointé sur un dossier vide — ce
  dernier fait tomber les quatre, c'est le plancher.
- **ET LE MÊME FIL A RENDU UN VRAI DÉFAUT : LES DEUX PAGINEURS DU DÉPÔT NE TRAITAIENT PAS LE MÊME
  CAS DE LA MÊME FAÇON, ET C'EST LA SAUVEGARDE QUI ÉTAIT LA PLUS LAXISTE** (22/09/2026, trouvé en
  vérifiant une AUTRE affirmation — celle de `lectureComplete.ts` selon laquelle le socle de
  sauvegarde « se rattrape en REFUSANT »).

  | | compte ABSENT | compte qui ne colle pas |
  |---|---|---|
  | `lireTout` (écrans) | **`complete: false`** | `complete: false` |
  | `lireToutesLesLignes` (sauvegarde) | **accepté en silence** | refus |

  **Le garde était donc plus strict sur un BANDEAU D'ÉCRAN que sur le fichier dont on restaure.**
  `if (annonce != null && annonce !== lignes.length)` : sans total annoncé, le contrôle ne se
  déclenche pas, et la boucle s'est arrêtée sur une tranche plus courte que demandée — l'indice de
  fin que ce fichier désigne lui-même comme FAIBLE, puisqu'un plafond serveur plus bas que
  `TAILLE_PAGE` le produit aussi. La sauvegarde repartait amputée, sans un mot.
  **ET SON PROPRE EN-TÊTE NOMMAIT LE DÉGÂT TROIS LIGNES AU-DESSUS** : « une sauvegarde qu'on ne peut
  pas dire complète ne vaut pas mieux qu'une absence de sauvegarde, **à ceci près qu'elle
  rassure** ». C'est la forme la plus fréquente de cette famille dans ce dépôt, et c'est sa
  cinquième occurrence — cette fois dans le fichier dont toute la raison d'être est d'être digne de
  confiance.
  **LE RATTRAPAGE PROMIS PAR `lectureComplete.ts` ÉTAIT DONC À MOITIÉ VRAI** : le socle refuse bien
  sur un compte qui ne colle pas, jamais sur un compte ABSENT — or c'est exactement le cas que la
  documentation de `lireTout` désigne comme décisif (« sans lui, "rien de plus à lire" et "le serveur
  ne veut plus rien rendre" sont indiscernables »). Une vérification qui prouve une chose plus faible
  que celle qu'on lui prête, encore.
  **LE CORRECTIF FERME AUSSI LA LIMITE DOCUMENTÉE, ce qui est le vrai gain** : le compte étant
  désormais garanti non nul, l'arrêt sur tranche courte est TOUJOURS rattrapé par la comparaison au
  total. Ce fichier décrivait cette limite comme « compensée par un refus » ; elle l'est maintenant
  sans trou.
  **POURQUOI REFUSER NE COÛTE RIEN, dit comme une INFÉRENCE et non comme une mesure** : `lireTout`
  rend `complete: false` sur un compte nul depuis qu'il existe, sur les 110 sites de lecture du
  dépôt, et aucun bandeau n'est affiché en permanence. Un compte absent ne se produit donc pas en
  fonctionnement normal — c'est un chemin défensif, et le refuser ne bloque aucune sauvegarde réelle.
  **LE FAUX CLIENT NE POUVAIT PAS EXERCER LE CAS** : `base.compteAnnonce[table] ?? lignes.length`
  annonce TOUJOURS un compte, et `compteAnnonce` ne sait dire qu'un nombre. « La base n'annonce
  rien » est un état distinct de « la base annonce autre chose », et il n'avait aucun levier. D'où
  `base.sansCompte`, et une mutation qui le retire.
  **DEUX RÉSULTATS NÉGATIFS DU MÊME BALAYAGE, à garder** : le tri de `lireToutesLesLignes` est bien
  TOTAL (`for (const colonne of tri)` — chaque colonne de la clé primaire, pas seulement la
  première, ce qui compte pour les six tables à clé composite), et le refus sur compte divergent
  existe et mord. Ne pas les réenquêter.
  **Cinq mutations, toutes mordent, et la discrimination est le résultat** : le code TEL QU'IL ÉTAIT
  ne fait tomber qu'UN test, celui écrit pour lui ; « le socle refuse TOUTE sauvegarde » en fait
  tomber 25 et « `0` confondu avec aucun total » 22 — ce sont les deux gardes symétriques, sans
  lesquelles « refuse ce qu'il ne peut pas dire complet » serait satisfait par un socle qui refuse
  tout, ou par un socle qui casse sur toute table vide.
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
  **ET UN TROISIÈME CHAMP MANQUAIT AU MÊME CONTRÔLE — LA DATE, ET ELLE COÛTE PLUS CHER QUE LE
  COMPTE** (21/09/2026). Le compte gardait au moins la bonne ANNÉE ; la date, non. Une pièce validée
  sans date reçoit une écriture datée de son DÉPÔT (`lignesChargeProduitPourPiece` : `date_piece ??
  dateLocaleDe(created_at)`, repli délibéré et déjà figé par un test). « Retrouver les dates
  manquantes » écrit ensuite `date_piece` **et rien d'autre** — c'est précisément ce qui la rend
  sûre à lancer sur un dossier relu à la main — donc rien ne réconcilie l'écriture. Corriger à la
  main la date d'une pièce déjà générée fait exactement pareil.
  **L'ÉCART N'EST PAS UNE APPROXIMATION, IL EST MESURÉ** : sur les pièces réelles du projet, le
  dépôt suit la date de la pièce de **549 jours en MÉDIANE**, 1 336 au maximum, et **68 pièces**
  portent une année de dépôt différente de leur année de pièce. L'écriture part donc dans le mauvais
  EXERCICE : `ecrituresFiltrees` et le FEC lisent `e.date`, pendant que Clôture et la 2035 lisent
  `date_piece`. Le FEC **embarque la contradiction sur UNE SEULE LIGNE**, sa colonne `PieceDate`
  venant de la pièce (`dateDePiece` préfère déjà `date_piece`) et `EcritureDate` de l'écriture — et
  la charge se retrouve dans le FEC d'une année pendant qu'elle est en 2035 dans l'autre.
  **On ne compare QUE si la pièce porte une date**, et c'est la décision qui empêche le contrôle de
  crier au loup : sans date, elle ne prétend à aucun exercice (même arbitrage que la feuille
  « Pièces sans date » d'un pack), donc il n'y a rien à contredire — et comparer au repli
  signalerait toute écriture générée dans un autre fuseau que celui qui la relit, `dateLocaleDe`
  lisant un INSTANT. La contrepartie banque reste exclue, sa date étant celle du PAIEMENT : la
  retenir signalerait chaque pièce rapprochée, c'est-à-dire celles qui sont en ordre.
  **LATENT lui aussi, et mesuré** : zéro écriture en base dont la date diffère de celle de sa pièce,
  zéro pièce validée sans date prête à être comptabilisée. Comme ses deux aînés, ce qui le rend digne
  d'être corrigé n'est pas un préjudice constaté mais qu'il ne PEUT pas se voir une fois arrivé.
  **Cinq mutations, et la cinquième a d'abord SURVÉCU** : `every` au lieu de `some` ne se distingue
  sur aucune donnée productible, `lignesChargeProduitPourPiece` donnant la même date à toutes ses
  lignes et la régénération les remplaçant toutes (0 groupe à dates mélangées en base). Le cas est
  donc ajouté comme DÉFENSIF et annoncé comme tel plutôt que déguisé en cas réel : `every` se
  TAIRAIT sur un groupe à moitié périmé le jour où un écrivain partiel apparaîtra, et un contrôle
  qui parle trop se corrige quand celui qui se tait ne se voit pas.
  **Le texte du panneau mentait déjà** : il annonçait « montant, TVA... » et n'avait jamais été
  repris quand le compte a rejoint le contrôle la veille. Il nomme désormais les quatre, et le
  tableau porte la date actuelle à côté du montant — sans quoi un « à régénérer » sur une pièce dont
  le montant est juste ne dit pas ce qui a bougé.
  **ET LE QUATRIÈME CHAMP ÉTAIT CELUI QUE LE PANNEAU PROMETTAIT DEPUIS TOUJOURS : LA VENTILATION DE
  LA TVA** (21/09/2026). Corriger `montant_tva` en gardant le TTC laisse le total du groupe
  RIGOUREUSEMENT inchangé — les deux lignes se compensent — et les comptes identiques : ni la
  comparaison de montant ni celle de compte ne peut en dire un mot. Même silence quand la TVA est
  ajoutée ou effacée après coup, le NOMBRE de lignes changeant sans que leur somme bouge.
  **CELUI-CI N'EST PAS LATENT — il est DÉMONTRÉ sur une pièce du schéma**, et c'est le premier des
  quatre dans ce cas : `IMG_3582.jpeg` porte 57,00 € en charge entière alors que la pièce annonce
  50,91 + 6,09 de TVA. Validée, catégorie « Notes de frais » dont le compte 625700 est bien celui de
  l'écriture, total juste au centime — **aucun des trois contrôles ne la voyait**. Sa voisine
  `IMG_5164.JPEG` (199,99 € contre 199,00) était, elle, déjà prise par la comparaison de montant :
  c'est ce qui rend la première distinctive. Les deux sont dans `deltasoins 10`, un bac à sable
  abandonné sur données fictives : **ce qui est démontré est le MÉCANISME, pas un préjudice
  comptable** (voir « État des données »).
  **Ce que ça coûte** : la charge et la TVA déductible partent FAUSSES en FEC et en balance, à somme
  juste — 6,09 € déplacés de l'une à l'autre — pendant que la 2035, calculée sur les pièces, dit
  autre chose. Encore deux livrables pour un seul euro, et le cross-check TVA de l'onglet Écritures
  ne le rattrape que si une déclaration existe sur la période.
  **On compare la TVA ENREGISTRÉE à celle que la pièce annonce, 0 quand elle n'en porte pas** — ce
  qui couvre l'ajout et l'effacement d'un seul test — et SIGNÉE comme le total, sinon chaque avoir
  portant de la TVA deviendrait un faux positif. Les deux comptes, déductible ET collectée : n'en
  regarder qu'un rendrait le contrôle aveugle sur la moitié des pièces et bavard sur l'autre.
  Quatre mutations mordent, dont le code tel qu'il était.
  **ET IL A EXPOSÉ UN JEU D'ESSAI INCOHÉRENT** — troisième de la journée, par une troisième porte :
  un test existant portait 20 € de TVA au brouillon sur une pièce dont `montant_tva` était nul,
  combinaison que `lignesChargeProduitPourPiece` ne produit jamais. Il passait parce qu'aucun
  contrôle ne regardait la ventilation. Ni le compilateur ni le balayage des NOT NULL ne pouvaient le
  voir : l'incohérence n'est pas dans un champ, elle est ENTRE deux objets du même jeu d'essai.
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
  **REJOUÉ LE 23/09/2026, TROISIÈME PASSAGE : QUATORZE lectures filtrées, ZÉRO en faute** — toutes
  alimentent un `piecesValidees`, `recettesValidees`, `piecesAValider`, `piecesRapprochees` ou un
  `sansDate`. Le seul cas qui a demandé une VÉRIFICATION plutôt qu'une lecture est `BanqueTab`, dont
  le `.in('statut', ['a_valider', 'validee'])` a toutes les apparences d'un sous-ensemble et couvre
  en réalité **tout** le type `Statut`, qui n'a que ces deux valeurs : son état s'appelle donc
  `pieces` à juste titre. **À connaître pour le jour où une troisième valeur s'ajouterait** : cette
  énumération est une liste d'inclusion, et elle se tairait — la panne que ce dépôt connaît sous
  cinq autres noms.
- **UNE LECTURE PLUS LENTE ÉCRIT EN DERNIER, ET L'ÉCRAN MENT SANS LE DIRE** (`PacksTab`, corrigé le
  21/09/2026). Trente et un `useEffect` du projet relancent un chargement quand leurs dépendances
  changent, et **trente n'ont aucune annulation** — mais ce n'est pas une liste de trente défauts :
  c'est la colonne des DÉPENDANCES qui décide. Toutes sont `dossierId` ou équivalent, qui ne change
  qu'à la navigation. **Une seule dépend d'une valeur que l'opérateur modifie en boucle, écran
  ouvert** : l'aperçu d'un pack, sur `[dossierId, periodeDebut, periodeFin]`.
  Deux changements de date rapprochés lancent donc deux lectures qui se chevauchent, et c'est la
  dernière ARRIVÉE qui écrit — pas la dernière demandée.
  **ET LA COURSE PENCHE TOUJOURS DU MÊME CÔTÉ, ce qui la rend pire qu'un tirage au sort** : `lireTout`
  fait d'autant plus d'allers-retours que la période est large, donc la période LARGE est la plus
  lente à revenir. Rétrécir la période — « finalement, juillet seul » — est le geste courant, et
  c'est exactement celui qui laisse à l'écran le compte et le total de la période d'avant, sous des
  dates qui en annoncent une autre.
  **Ce que ça coûte** : l'opérateur lit un chiffre, génère, et le pack ne contient pas cela — sur le
  livrable qu'on envoie au comptable. C'est le même écran dont l'aperçu était déjà « plus optimiste
  que le générateur qui allait refuser juste après », et `previewIncomplet` se trompe de la même
  façon : une lecture périmée peut effacer le bandeau d'une période réellement partielle.
  **Le contrôle se pose APRÈS les lectures et AVANT la première écriture**, et c'est le seul endroit
  qui vaille — la course se joue sur l'ordre d'ARRIVÉE, donc le poser avant les lectures ne verrait
  rien. Une mutation le prouve : déplacé en tête, le test de course retombe au rouge. Le garde est le
  drapeau d'annulation déjà utilisé par l'aperçu de `PieceFormModal` ; la lecture continue (on ne
  rappelle pas une requête partie), elle n'écrit plus.
  **Trois tests, quatre mutations, toutes mordent** — dont le code TEL QU'IL ÉTAIT, ce qui prouve que
  ce n'est pas de la couverture. Et deux des trois tests sont des gardes SYMÉTRIQUES : « tout est
  périmé » les fait tomber tous les trois, donc un correctif qui figerait l'écran au lieu de le
  réparer est attrapé aussi. Sans eux, « l'écran n'affiche pas le mauvais chiffre » serait satisfait
  par un écran qui n'affiche jamais rien.
  **Aucun test de `src/lib` ne pouvait le voir** : `lireTout` est juste, `packGenerator` est juste,
  c'est l'ORDRE D'ARRIVÉE de deux appels corrects qui produit le mensonge.
  **Le balayage vaut plus que la prise, et sa forme utile n'est pas « qui n'annule pas »** (trente
  réponses, aucun signal) **mais « de quoi dépend l'effet »** : une dépendance que l'utilisateur
  change à la main, écran ouvert, est la seule qui puisse courir contre elle-même. À rejouer sous
  cette forme quand un écran gagne un filtre.
- **LA BARRE LATÉRALE A ROUVERT UNE COURSE QUE LE TABLEAU DE BORD FERMAIT** (`DossierDetail`,
  25/09/2026). Avant l'étape 1, changer de dossier passait par le tableau de bord, donc DÉMONTAIT la
  page d'un dossier. La barre latérale mène désormais directement de A à B, même route, autre `:id`,
  et la page reste montée. L'entrée ci-dessus dit des trente effets sans annulation que
  « `dossierId` ne change qu'à la navigation » : c'est resté vrai de tout ce qui vit SOUS
  `AnneeProvider key={id}`, dont les onglets se remontent, et c'est devenu faux de ce qui vit
  au-dessus — l'identité du dossier et ses années, lues par la page elle-même.
  **EN PRODUCTION du déploiement de l'étape 1 (25/09/2026, 11 h 37) jusqu'à celui de ce correctif.**
  Pendant la lecture de B, l'en-tête et les onglets portaient l'identité de A ; une réponse de A
  arrivée APRÈS celle de B la remplaçait pour de bon, faute d'annulation. Et trois gestes
  élargissaient la fenêtre bien au-delà d'une lecture lente : « Détecter la profession » (un appel à
  une API extérieure), la bascule TVA refusée, et les deux rappels d'identité des onglets — chacun
  réécrivait l'objet de A, CAPTURÉ au clic, sur la page de B.
  **Ce que ça coûte n'est pas un affichage : plusieurs onglets RECOPIENT l'identité reçue.**
  `FactureFormModal` fige `emetteur_nom` et `emetteur_siret` dans la facture validée — IMMUABLE,
  corrigeable seulement par un avoir ; le formulaire d'identité d'`InformationsTab` recopie SIRET et
  adresse au montage et les ÉCRIT à l'enregistrement ; `AccesTab` copie l'adresse de collecte par
  e-mail — celle de A, donnée au client de B, enverrait ses pièces dans le dossier A.
  **ET LE DÉFAUT D'ORIGINE PRÉCÉDAIT LA BARRE** : les onglets se montaient dès que les années étaient
  lues, identité lue ou non. Trois lectures contre une seule, l'identité arrive d'ordinaire la
  première ; mais REFUSÉE, elle laissait les onglets montés pour de bon sur une identité vide — une
  facture validée sans émetteur, un formulaire d'identité qu'« Enregistrer » vidait. C'est la
  cinquième forme de « lecture → formulaire → écriture de tous les champs », dans un écran qui
  portait déjà la première, arrivée cette fois par les PROPS.
  **Le remède** : l'identité et les années sont gardées AVEC l'identifiant pour lequel elles ont été
  lues, et ne valent que pour celui de l'URL — ce qui appartient à un autre dossier vaut nul, et
  l'écran attend. Les onglets ET le sélecteur d'exercice ne se montent qu'avec les deux (`pret`) :
  le sélecteur lit l'`AnneeProvider`, et rendu dans l'en-tête pendant l'attente, HORS de ce
  fournisseur, il LEVAIT et emportait la page entière — défaut introduit par le premier jet de ce
  correctif et trouvé en relisant, les tests d'alors ne passant que par des écrans sans exercice.
  Une modification (TVA, NAF, identité) ne touche que le dossier qu'elle vise. Une lecture refusée
  le DIT — « Réessayer » relit — au lieu de laisser des squelettes indéfinis, et la dispense de
  `lecturesVerifiees` qui la couvrait est retirée : sa raison ne regardait que l'en-tête.
  **Neuf tests, douze mutations, toutes mordent, et le code TEL QU'IL ÉTAIT fait tomber huit des dix
  tests du fichier.** Chacune des trois dérivations sans identifiant (identité, erreur, années) ne
  fait tomber que le test écrit pour elle.
  **LE MÊME DÉFAUT VIVAIT CÔTÉ CLIENT, ET SANS AUCUNE COURSE.** Le sélecteur de société ne quitte pas
  l'écran non plus, et `ClientInformations` ne remettait pas son formulaire à zéro sur une société
  qui n'avait encore rien répondu : il gardait les réponses de la précédente, qu'« Enregistrer »
  écrivait dans la nouvelle — `vehicule_type` compris, qui décide de la case BJ de la 2035. Antérieur
  à l'étape 1 et déterministe : il suffisait de changer de société. La coque clé désormais l'écran
  client par société (`<Outlet key>`), ce qui ferme aussi la course de lecture des quatre écrans
  client. `ClientInformations.test.tsx` garde les deux cas, et les trois mutations mordent (clé
  retirée, posée côté cabinet, constante).
  **La question qui en sort, à poser à chaque navigation ajoutée** : non plus « de quoi dépend
  l'effet ? » mais « ce composant se REMONTE-t-il quand cette dépendance change ? ». Sous une clé,
  un effet sans annulation écrit dans un composant démonté, ce que React ignore ; au-dessus, il
  écrit dans l'écran affiché. Balayé le 25/09/2026 : la page d'un dossier et les écrans client
  étaient les deux cas ; l'assistant est clé par dossier, la barre relit sa liste une fois par
  identifiant.
- **Et le frère du verrou a rendu un résultat NÉGATIF, mesuré le 21/09/2026** : un drapeau « en
  cours » (`setLoading`, `setSaving`…) relâché hors d'un `finally` a la même conséquence qu'un
  verrou — écran figé, bouton grisé ou spinner éternel. Le balayage brut rend 43 sites et ne dit
  rien, parce qu'un `load()` qui lit `{ error }` ne LÈVE jamais (règle du projet) : son
  `setLoading(false)` tombe toujours. Resserré sur la vraie question — le drapeau ET un appel qui
  peut lever —, il rend **zéro**. Et il n'est pas aveugle : 156 fonctions async parcourues, 88
  portant un drapeau, 16 appelant quelque chose qui lève, **14 les deux, et les 14 sont dans un
  `finally`**. Ne pas le rebalayer sans raison.
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
  **ET IL SE RELÂCHE DANS UN `finally`, JAMAIS EN CLAIR APRÈS L'`await`** — seconde moitié de la
  règle, restée non écrite jusqu'au 21/09/2026 parce qu'elle était seulement PRATIQUÉE : douze
  porteurs sur quatorze la respectaient sans que rien ne l'exige. Un relâchement posé en ligne laisse
  le verrou pris dès qu'une exception passe à côté, et l'écran se fige alors sans message : le bouton
  reste grisé, plus rien ne part, et rien ne dit pourquoi. C'est pire qu'un doublon, qui au moins se
  voit — et sur une action irréversible, l'utilisateur ne peut même pas savoir si elle est partie.
  **LES DEUX EN FAUTE ÉTAIENT EXACTEMENT LES DEUX DONT L'ACTION SORT DE L'APPLICATION**, et ce n'est
  pas une coïncidence utile à taire : `SuperPdpFactureModal` (une facture transmise à une plateforme
  agréée DGFiP) et `EnvoyerEmailModal` (un e-mail parti chez le client). Les douze autres, dont le
  doublon ne crée qu'une ligne, étaient corrects.
  **LE SECOND A ÉTÉ TROUVÉ PAR BALAYAGE, TROIS HEURES APRÈS LE PREMIER** — encore « chercher toutes
  les copies avant de corriger la première ». Et son test d'écran existait DEPUIS LA VEILLE : son
  commentaire disait mot pour mot « ici il n'y a pas de `try` », il avait donc le défaut sous les
  yeux et l'a traité comme un décor.
  **LA RÈGLE NE RESTE PLUS DANS CE FICHIER : elle est devenue un test** (`verrousExecution.test.ts`).
  Il part de TOUT `X.current = true` de `src`, exige que chaque `X.current = false` tombe dans un
  `finally` qui l'ENFERME — comptage d'accolades, parce qu'un `finally` déjà refermé plus haut
  tromperait un simple « y en a-t-il un avant ? » — et n'admet que des exceptions écrites, dont
  aucune à ce jour. Comme `rls.sql` part de `pg_class` et `lecturesPaginees` de toute lecture : un
  verrou ajouté demain est attrapé sans que personne ait à y penser.
  **Ce qu'il ne garde PAS, annoncé plutôt que laissé deviner** : que le verrou soit posé AVANT le
  `try`. Cela ne se lit pas de façon fiable sur du texte, et c'est déjà gardé écran par écran par le
  cas à TROIS clics de chaque test de modale — le seul qui distingue les deux placements.
  Cinq mutations mordent, dont le défaut d'origine replanté et le `finally` déjà refermé ; la
  mutation « le scanner ne lit plus rien » en fait tomber DEUX, les deux bornes posées pour que
  « zéro faute » et « aveugle » restent distinguables.
  **Les porteurs se recensent ici, et un ordinal dispersé ne tient pas.** Deux sessions travaillant
  en parallèle le 20/09/2026 ont écrit « troisième » et « cinquième » pour ce motif dans ce fichier.
  Un rang inscrit au fil du texte oblige à recompter à chaque ajout, sur des paragraphes que
  personne ne relit ensemble : la liste vit donc en un seul endroit, celui-ci.
  **Douze fois trouvé à ce jour** — `ImportDossierModal` (import en masse), les deux relectures OCR
  (`PiecesTab` et `DocumentsTab`), « C'est une facture » (`DocumentsTab`, qui n'avait aucun verrou),
  « Tout rapprocher automatiquement » (`BanqueTab`), puis quatre trouvés d'un coup par l'audit
  ci-dessous (20/09/2026) : `EnvoyerEmailModal.envoyer`, `SuperPdpFactureModal.appeler`,
  `FactureAvoirModal.creerAvoir` et `PieceFormModal.save` — deux de plus le 23/09/2026,
  `FactureFormModal.enregistrer` et `AjouterDocumentsModal.lancerImport`, que cet audit ne POUVAIT
  pas voir (entrée dédiée plus bas) — et `AccesTab.handleCreateAccess` le 24/09/2026, posé par la
  Routine du matin sur `main` et réuni à cette branche le 25/09/2026. Celui-là figurait pourtant
  parmi les 36 candidats du balayage ci-dessous (`functions.invoke` sans `.current`), classé avec les
  32 laissés de côté comme « leur doublon crée une LIGNE, qu'un cabinet voit et supprime ». Ce
  classement était faux pour lui : la ligne `memberships` est protégée par une contrainte unique (la
  fonction la détecte et rend 409), donc le doublon ne crée pas de ligne en trop — il fait courir
  deux appels `auth.admin.createUser` pour la même adresse, avec au bout un message d'erreur qui
  laisse croire à un échec alors que l'accès vient d'être créé par l'autre requête. **Un candidat
  écarté par la classification d'un balayage reste un candidat à revérifier au cas par cas, pas un
  candidat clos.**
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
  écrire « six » à la première tentative de ce recensement. Dix-sept verrous existent aujourd'hui
  dans `src` (seize `useRef` booléens — les deux verrous des lots de `BanqueTab` n'en font plus qu'un
  depuis le 25/09/2026, partagé avec le panneau d'un mouvement — et l'ensemble par document de
  « C'est une facture »), et
  six sont nés corrects avec leur fonctionnalité (`VehiculesCard`, `ClotureTab`,
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
- **DEUX ÉCRIVAINS, DEUX CONVENTIONS DE SIGNE, DANS LA MÊME COLONNE** (`references_postes_annuels`,
  21/09/2026). Le bouton « Calculer le détail par poste » d'Estimation multipliait chaque dépense par
  −1 et écrivait donc des montants NÉGATIFS ; le formulaire juste au-dessus, dans la même carte, y
  écrit ce que le cabinet tape — un loyer se saisit « 12000 ». Les deux lignes s'affichent dans le
  MÊME tableau, sous un titre qui dit « autres charges », l'une à 12 000,00 € et l'autre à
  −8 450,00 €, sans que rien n'explique la différence.
  **La convention du projet était pourtant déjà écrite, deux fois** : `cases2035.ts` dit « `montant`
  reste positif, le signe est porté par la nature », et `totauxPourAnnee` — dans le module même où ce
  calcul atterrit désormais — rend un `ca` et des `cotis` positifs. C'est donc le CALCUL qui rentre
  dans le rang, pas la saisie.
  **ET LES RECETTES N'AVAIENT RIEN À FAIRE LÀ, ce que son propre commentaire disait déjà** : « ici on
  ne veut que les postes de charge issus des catégories ». Le code, lui, ne le faisait pas — une
  pièce de VENTE dont la catégorie porte un poste 2035 entrait dans la carte « autres charges »,
  positive, indiscernable d'une charge une fois écrite. Le chiffre d'affaires a son propre champ,
  dans `references_annuelles`.
  **LATENT au sens le plus fort** : `references_postes_annuels` est VIDE dans toute la base, la
  fonctionnalité n'ayant jamais été exercée — « une table vide parce que rien ne l'a encore exercée
  ne prouve rien ». Ce qui la rend digne d'être corrigée est qu'une fois deux lignes écrites par les
  deux chemins, rien ne dirait laquelle suit quelle convention.
  **Trouvé par un balayage qui vaut plus que la prise** : les fonctions de CALCUL définies dans les
  écrans (59 dans `src/pages` et `src/components`), croisées avec les exports de `src/lib`. Un seul
  homonyme, `csgDeductible` — et il est **légitime**, l'écran important la fonction du module sous
  alias pour l'envelopper du cas `null`. Ce sont les plus LONGUES qui ont payé, pas les homonymes :
  la duplication se cherche par la VALEUR, jamais par le nom, comme `calculerLigne` /
  `calculerLigneMontants`. À ne pas rebalayer sans raison.
  Dix mutations mordent, dont le code tel qu'il était, la valeur absolue (qui ferait d'un avoir une
  charge de PLUS), et l'écran qui passe `recettesValidees` au lieu de `piecesValidees` — que le type
  ne peut pas voir, les deux étant des `Piece[]`.
  **Et le compilateur a attrapé le premier jeu d'essai** : `Categorie` n'a ni `nom` ni `type` mais
  `code` et `libelle`. Quatrième écran où la contrainte de type sans `as` mord avant qu'un test
  n'ait tourné.
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
  **ET LE MODULE AVAIT RAISON PENDANT QUE L'ÉCRAN TRANCHAIT À PILE OU FACE** (21/09/2026). Cette
  règle vaut pour VALIDER une pièce ; l'écran Banque, lui, RELIE un mouvement à une pièce déjà
  validée par un humain, ce qui est une barre plus basse et assumée — deux signaux, cinq jours au
  lieu de sept. Deux tolérances distinctes, deux noms, et c'est délibéré.
  **Ce qui n'était pas une politique, c'était de trancher au hasard.** « Tout rapprocher
  automatiquement » faisait `piecesValidees.find(...)` puis « consommait » la pièce avant de passer
  à la ligne suivante : quand deux pièces convenaient aussi bien l'une que l'autre, **la première de
  la liste gagnait** ; quand une pièce convenait à deux mouvements, **le premier mouvement rencontré
  l'emportait**. Ni l'un ni l'autre n'est un choix — c'est un effet de l'ordre de tri, appliqué à N
  lignes sur un seul clic, sans confirmation.
  **`motifDeDoute` nommait pourtant ce cas exact, trente lignes plus haut dans le module que l'écran
  n'utilisait pas ici** : « deux factures mensuelles identiques, ou une pièce déposée deux fois ».
  Et le cas est celui de ce dossier — les deux dépôts Transmedical à 38,40 € du même document,
  décrits plus bas. Le module refusait de trancher pendant que l'écran tranchait : encore deux
  réponses pour la même question, dont une seule est testée.
  **LATENT, et mesuré** : zéro collision entre pièces VALIDÉES dans toute la base (deux pièces de
  même montant au centime dont les dates tiennent dans la même fenêtre). Comme les autres de cette
  famille, ce qui le rend digne d'être corrigé n'est pas un préjudice constaté mais qu'il ne PEUT
  pas se voir une fois arrivé : le mauvais justificatif attaché au mouvement, le vrai mouvement de
  l'autre mois laissé sans pièce, et les deux en piste d'audit.
  **`planRapprochementAutomatique` applique l'unicité mutuelle DANS LES DEUX SENS** et l'écran DIT
  combien de mouvements il laisse de côté — un bouton qui annonce N en en traitant moins ne dit pas
  où sont passées les autres (règle du pack). Le commentaire de `rapprocherTout` promettait d'ailleurs
  « un seul candidat disponible » bien avant que ce soit vrai.
  **La précédence pièce > cotisation est CONSERVÉE telle quelle** : ce n'est pas un arbitrage entre
  égaux mais une règle de l'écran, et la changer serait une décision produit, pas une correction.
  **Dix mutations, neuf mordent** — dont le code tel qu'il était des deux côtés, l'unicité dans un
  seul sens, et les gardes symétriques (« on ne retient plus jamais rien », « l'écran crie toujours
  à l'ambiguïté »). **La dixième est à garder telle quelle** : remplacer `jourDe` par
  `new Date(iso).getTime()` — ce que l'écran faisait — ne change RIEN sur des dates civiles, les deux
  formes passant par minuit UTC. Ce que `jourDe` apporte est de la FORME (il ne peut pas se mettre à
  dépendre d'un fuseau), pas du comportement, et c'est écrit dans le test plutôt que maquillé en
  assertion de complaisance.
- **LA BANQUE FAIT FOI, MAIS SOUS UN SEUIL — décision du cabinet, 23/09/2026** (« Décisions en
  attente » : « quand une pièce est rapprochée d'un mouvement bancaire, est-ce que le montant de la
  banque doit écraser celui de la pièce ? » → oui, en alignant sous un petit écart et en SIGNALANT
  au-delà).
  **CE QUI EXISTAIT DÉJÀ, ET POURQUOI IL NE COUVRAIT QU'UN CAS** : `reglerPieceSurBanque` alignait
  les seules pièces en DEVISE, et sans seuil — là c'est indéniable, la valeur posée au dépôt au taux
  BCE n'étant qu'un provisoire. Une pièce en EUROS, elle, porte déjà un montant que quelqu'un a lu
  sur un document.
  **POURQUOI LE SEUIL PLUTÔT QU'UN ALIGNEMENT SEC, et c'est l'arbitrage qui a été remis au cabinet
  avant d'écrire une ligne** : les données ne distinguent pas un frais bancaire d'un PAIEMENT
  PARTIEL. Aligner sans seuil enregistrerait une facture de 1 000 € payée en deux fois comme une
  dépense de 500 €, sur une pièce le plus souvent déjà validée, et le montant d'origine serait perdu.
  Le seuil est `min(2 % du TTC, 5 €)` : relatif parce qu'un centime sur 12 € et sur 12 000 € ne
  disent pas la même chose, plafonné parce que 2 % d'une grosse facture (100 € sur 5 000 €) est
  largement de quoi couvrir un acompte. **Pas de plancher, et c'est mesuré** : 2 % couvre déjà un
  centime dès 0,50 €.
  **ET L'ÉCART NE SE VOYAIT NULLE PART TANT QUE LES ÉCRITURES N'ÉTAIENT PAS GÉNÉRÉES.**
  `synchroniserContrepartieBanque` écrit la contrepartie sur `Math.abs(ligne.montant)` et la charge
  sur le TTC de la pièce, donc un écart déséquilibre le groupe et `groupesDesequilibres` finit par le
  dire — mais elle SORT avant d'écrire quoi que ce soit tant que la pièce n'a pas sa ligne de charge
  (catégorie sans compte, « Générer » pas lancé). Et le menu « Associer à… » de Banque est un SCORE,
  pas un filtre : rien n'empêche de relier une pièce de 1 000 € à un mouvement de 500 €.
  `rapprochementsEcartImportant` (lib/controles.ts) le signale — pastille dans la liste ET dans le
  panneau de Banque, point « erreur » en Checklist.
  **LE MODULE A ÉTÉ RENOMMÉ `reglementBanque.ts`** : `reglementDevise` aurait menti sur ce qu'il
  fait, et c'est le piège que ce fichier nomme sous « un nom qui ment sur son filtre » — le
  compilateur a énuméré les appelants exhaustivement.
  **Trois décisions de forme** : le calcul pur vit à part (`alignementBanque.ts`, sans `supabase`,
  donc testable) ; on compare les VALEURS ABSOLUES, une pièce d'achat étant positive et son mouvement
  négatif ; et une pièce en euros ne reçoit NI `taux_change` NI `conversion_source` — lui en écrire
  un la ferait passer pour convertie, donc afficher un cours qui n'a jamais existé sur un document
  en euros.
  **LATENT, et mesuré** : 12 lignes rapprochées sur une pièce, **zéro dont le montant diffère**. Le
  correctif ne change donc aucun chiffre existant.
  **DIX-HUIT MUTATIONS, TOUTES MORDENT — et la PREMIÈRE a survécu, accusant le jeu d'essai.**
  « Le code tel qu'il était » (aucun alignement en euros) laissait les seize tests du chantier au
  VERT : le CALCUL était couvert, le SIGNAL aussi (les deux écrans), et personne ne vérifiait que la
  pièce soit RÉELLEMENT ÉCRITE — c'est-à-dire précisément ce que la décision du cabinet demandait.
  `reglementBanque.test.ts` ferme ce trou, et deux mutations de plus y mordent (le taux de change
  écrit sur une pièce en euros, le chemin devise routé vers le seuil).
  La discrimination est le reste du résultat : la pastille de la LISTE et celle du PANNEAU font
  tomber un test chacune (deux copies, gardées séparément), le point de Checklist un autre, et les
  gardes symétriques des trois côtés — sans lesquels « l'écran signale l'écart » serait satisfait par
  un écran qui crie sur TOUS les rapprochements.
- **LE VOLET A OUVERT UNE COURSE QUE LA FENÊTRE INTERDISAIT : un lot et une action du panneau sur le
  même mouvement** (25/09/2026, en portant le rapprochement dans le panneau de droite). Tant que le
  rapprochement vivait dans une fenêtre qui recouvrait l'écran, on ne pouvait pas lancer « Tout
  rapprocher » ou « Valider et rapprocher les N » en arbitrant une ligne. Le volet laisse la liste
  cliquable — c'est tout son intérêt —, donc les deux peuvent se croiser sur le même mouvement, et deux
  écritures qui se croisent laissent une contrepartie banque pour une pièce que le mouvement ne
  désigne plus. Aucun des trois chemins n'était en faute pris seul : chacun avait un verrou juste, et
  aucun ne voyait les deux autres.
  **UN SEUL VERROU pour toutes les écritures de rapprochement de l'écran** (`ecritureEnCours`, par
  `sousVerrou`), à la place des deux verrous des lots. Il se relâche APRÈS la relecture du relevé :
  relâché avant, le panneau — qui reste désormais sur le mouvement — montrerait « Associer cette
  pièce » sur un mouvement déjà rapproché le temps que la relecture revienne, et un second clic
  referait le rapprochement. Chaque action dit si elle a écrit, et `ignorer` comme
  `marquerVirementPersonnel` LISENT leur erreur : sans conséquence tant que la fenêtre se fermait sur
  l'action, le silence devient trompeur quand le panneau reste sur un mouvement qu'on croit classé.
  **ET LE TROISIÈME CHEMIN DE RAPPROCHEMENT NE RÉGLAIT PAS LA PIÈCE SUR LA BANQUE** — trouvé en
  réécrivant ce bloc. Le rapprochement à la main et le lot « sans doute possible » appellent
  `reglerPieceSurBanque` avant la contrepartie ; « Tout rapprocher automatiquement » ne l'a jamais
  fait, parce qu'il n'avait aucun candidat en devise le jour où le règlement est né (18/09/2026). Une
  pièce en devise rapprochée par lui restait donc « provisoire » au cours BCE alors que la banque
  venait de donner son montant réel : un jumeau corrigé de deux côtés sur trois. **LATENT, et mesuré** :
  quatre pièces en devise en base, toutes provisoires, aucune rapprochée.
  **Quinze mutations, toutes mordent** (`BanqueTab.test.tsx`), dont le code TEL QU'IL ÉTAIT sur les
  quatre points — le choix appliqué au changement de la liste, l'erreur d'« Ignorer » non lue, « Tout
  rapprocher » sans règlement, le panneau qui se ferme après l'action —, le verrou posé dans le `try`
  (trois clics), le verrou du panneau séparé de celui des lots (qui fait tomber les deux sens), et le
  verrou relâché avant la relecture.

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
  **ET LA RÈGLE QUI EN EST SORTIE NE COUVRAIT QUE LES PIÈCES DATÉES — LE CAS SANS DATE EST PIRE**
  (21/09/2026). Le commentaire de `date-impossible` s'annonçait « le SEUL point de cette liste dont
  le bouton ne suffit PAS à trouver la pièce ». C'était vrai des pièces DATÉES, et d'elles seules.
  `PiecesTab` écarte toute pièce dont `date_piece` est nul dès qu'un exercice précis est choisi
  (`anneeFilter !== 'toutes' && (!p.date_piece || …)`) — et il l'est toujours, `calculerAnneeParDefaut`
  ne rendant « toutes » que sur un dossier VIDE. Une date impossible se retrouve en changeant
  d'année ; **une pièce sans date ne se retrouve sous AUCUNE année**, seulement par le filtre local
  « Sans date ». Quatre points visent Justificatifs en comptant des pièces qui peuvent n'avoir pas de
  date — sans catégorie, TVA impossible, devise non convertie, confiance basse — et aucun ne le
  disait. `mois-en-double` en est exempt par construction (il groupe par mois, donc exige des dates).
  **Le détail se CALCULE, il ne s'écrit pas en dur** (`detailPiecesSansDate`, lib/controles.ts) :
  rendu vide quand aucune pièce comptée n'est sans date, pour n'apparaître QUE quand il apprend
  quelque chose — une mise en garde permanente cesse d'être lue et emporte ses voisines. Il nomme les
  deux sorties (« toutes les années » et le filtre « Sans date », dont le libellé exact a été relu
  dans `PiecesTab` plutôt que supposé), et distingue « toutes » de « une partie » au singulier comme
  au pluriel.
  **LATENT, et mesuré** : **zéro pièce sans date dans toute la base**, les quatre dossiers confondus
  — la campagne « Retrouver les dates manquantes » du 20/09 les a toutes comblées. Ce n'est donc pas
  un préjudice constaté ; l'état revient au premier dépôt dont l'OCR ne sait pas lire la date, et
  c'est précisément pourquoi le détail est calculé plutôt qu'écrit.
  **Six mutations mordent**, dont le code tel qu'il était et « câblé sur un seul des quatre points » —
  s'arrêter à mi-chemin est exactement ce qui avait laissé vivre les deux badges manquants.
  **ET LE TEST D'ÉCRAN A TROUVÉ UN JEU D'ESSAI INFIDÈLE AU SCHÉMA** : `ChecklistTab.test.tsx` posait
  `devise: null`, or la colonne est **NOT NULL DEFAULT 'EUR'** — ce `null` n'existe nulle part en
  production. Comme `piecesDeviseNonConvertie` teste `devise !== 'EUR'`, vrai pour `null`, CHAQUE
  pièce du jeu d'essai comptait comme « devise non convertie ». Aucun test n'en échouait, ce qui est
  le propre du défaut : il ne se voit qu'en posant une assertion qui tombe dessus. `types.ts` disait
  juste (`devise: string`) ; c'est le `as`/objet nu du faux qui contournait le compilateur.
  **Et le `git checkout --` destiné à défaire une mutation a de nouveau emporté le test non commité
  du même fichier** — le piège que ce fichier nomme déjà, repayé le même jour. Il se voit au COMPTE
  de tests (55 attendus, 52 rendus), pas au vert : la suite restait verte, simplement plus courte.
  **ET LE BALAYAGE QUI A SUIVI A TROUVÉ LE JUMEAU, PUIS S'EST FAIT REMPLACER PAR LE COMPILATEUR.**
  Le balayage : toute colonne NOT NULL dans TOUTES les tables où son nom apparaît (86 noms, tirés
  d'`information_schema`), croisée avec un `X: null` dans un fichier de test. Trois prises, dont deux
  légitimes et instructives — un `date: null` qui est la RÉPONSE d'un modèle et non une ligne de
  table (un champ absent se cite `null`), et un `nom: null` qui est l'en-tête d'un formulaire 2035.
  La troisième était réelle : le même `devise: null` dans `BanqueTab.test.tsx`. **Et là il n'était
  pas inerte** : `reglerPieceSurBanque` sort sur `!piece.devise` AVANT son test `=== 'EUR'`, donc le
  test exerçait la branche du champ absent au lieu de celle d'une pièce en euros. Un jeu d'essai
  infidèle ne fait pas qu'affaiblir un test, **il lui fait prouver autre chose**.
  **La règle ne devient PAS un scanner, elle devient une CONTRAINTE DE TYPE** — et c'est mieux : les
  deux jeux d'essai d'écran sont désormais typés `(o: Partial<Piece> = {}): Piece` **sans `as`**,
  donc le compilateur vérifie chaque champ contre la table, exhaustivement, à chaque build. Un `as`
  ou un objet nu rend la vérification muette, et c'est exactement ce qui avait laissé passer le
  défaut. Même principe que « un piège qu'un nom supprime vaut mieux qu'un piège gardé par un
  contrôle » : le compilateur voit tout, un scanner ne voit que ce qu'on a pensé à lui montrer.
  **Le typage a mordu immédiatement** : `source: 'cabinet'` n'existe pas, `Source` valant
  `'upload' | 'email' | 'superpdp'` — une seconde infidélité que le balayage sur les NOT NULL ne
  pouvait pas voir, puisqu'elle porte sur le DOMAINE d'une valeur et non sur sa nullité. La mutation
  qui replante `devise: null` fait désormais échouer `tsc -b`, pas un test.
  **Piège de vérification à connaître** : `npx tsc -b 2>&1 | tail -5 && echo OK` affiche « OK » même
  quand `tsc` échoue — le code de sortie d'un pipe est celui du DERNIER maillon. Lire
  `${PIPESTATUS[0]}`, sinon le contrôle du typage se met à mentir comme les autres.
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
  **BALAYÉ EN ENTIER LE 23/09/2026, ZÉRO FAUTE — résultat négatif à garder.** Ce dépôt a payé DEUX
  fois ce motif (la règle tiers → catégorie muette des mois durant, l'index partiel de cette table),
  et rien ne le rejouait. Les **onze upserts** de `src/` et des Edge Functions ont été croisés avec
  les index uniques RÉELS de `pg_index` : tous désignent un index qui existe — et les deux qui
  n'écrivent aucun `onConflict` (`superpdp_credentials`, et `previsionnels_bancaires` avant qu'il ne
  le porte) retombent sur une clé primaire que leur payload renseigne. **Aucun index unique du
  schéma n'est partiel**, donc le piège de cette entrée n'a aujourd'hui aucune instance vivante. Et
  le cas historique est refermé des DEUX côtés : `cabinet_id` figure bien dans le payload de
  `PieceFormModal` comme de `CategoriserTiersModal`.
  **CE MOTIF NE DEVIENT PAS UN SCANNER, et c'est dit plutôt que laissé deviner** : ce qui l'avait
  rendu invisible était le résultat JETÉ, pas la forme de l'`onConflict` — un `onConflict` qui ne
  désigne rien rend aujourd'hui un 42P10 que `lecturesVerifiees` et `edgeFunctionsEcritures`
  garantissent lu. Le seul reste silencieux serait `ignoreDuplicates: true` posé sur une ligne qu'on
  voulait METTRE À JOUR ; il n'y en a qu'un dans le dépôt (`facture_superpdp_events`), où des
  événements ne se réécrivent pas. Un contrôle pour un site unique et correct serait du bruit.
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
  **Ce que cet ordre coûte, mesuré le 21/09/2026 sur un dépôt réel, et laissé tel quel** : une
  ATTESTATION DE VIGILANCE URSSAF (marqueurs `URSSAF` + `ATTESTATION` + « vigilance », zéro montant
  lisible, aucun échéancier reconnu par les deux formats) ressort en `cotisation` et non en
  `attestation`, le marqueur URSSAF étant testé le premier. **Ce n'est pas un défaut mais une
  étiquette** : les deux classifications mènent à Documents, où seules `categorie` et le texte sont
  écrits. Ajouter un marqueur « vigilance » demanderait un redéploiement de la fonction
  d'extraction, ce qu'une étiquette ne paie pas — noté pour ne pas le réenquêter à chaque audit.
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
  **ET CE DOCUMENT N'A PAS À ARRIVER DU TOUT (24/09/2026)** : un praticien n'a pas le droit de
  transmettre ses bordereaux au cabinet, c'est le relevé SNIR qui justifie les recettes. Ce qui est
  décrit ici est donc le traitement d'un dépôt fait PAR ERREUR, pas un flux normal de la mission —
  et le libellé « justificatif de RECETTE » de la fiche pièce le présente à tort comme légitime. Le
  code reste en l'état par décision du cabinet (voir « Contraintes de sécurité et RGPD »).
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
  **21/09/2026 — huitième porteur, et LE LOT DES QUATRE EST FERMÉ** : `SuperPdpFactureModal.appeler`,
  dont le doublon est le seul à SORTIR de l'application — il transmet deux fois la même facture à une
  plateforme agréée DGFiP, et une facture transmise ne s'annule pas par cette voie (seul un avoir la
  corrige). Quatre tests, cinq mutations, toutes mordent.
  **ET CE TEST A TROUVÉ UN SECOND DÉFAUT, celui qu'il fallait l'écrire pour voir** : ce verrou était
  le SEUL des quatre sans `try`. Son relâchement vivait en clair après l'`await` —
  `setEnCours(false)` puis `appelEnCours.current = false` — donc toute exception sortait de la
  fonction sans relâcher quoi que ce soit. L'écran retombait alors dans son pire état possible :
  bouton grisé, aucun message, aucun moyen de réessayer sans rouvrir la modale, sur une action
  irréversible dont l'utilisateur ne peut pas savoir si elle est partie.
  **La preuve que ce n'est pas de la simple couverture** : la mutation qui remet le code TEL QU'IL
  ÉTAIT ne fait tomber qu'UN des quatre tests, celui de l'exception. Les trois autres passaient déjà.
  **Règle complétée, parce qu'elle était énoncée à moitié** : le verrou se pose AVANT le `try`, et il
  se relâche DANS un `finally` — jamais en clair après l'`await`. La première moitié était écrite
  depuis longtemps ; la seconde était seulement pratiquée, donc elle a fini par être oubliée une
  fois.
  **ET LA ROUTINE A TROUVÉ, DE SON CÔTÉ, LA SECONDE CONSÉQUENCE DU MÊME CODE** (23/09/2026, sur
  `main`, qui n'avait pas encore ces tests). Un relâchement posé en clair après le PREMIER `await` ne
  coûte pas seulement le verrou sur une exception : il tombe AVANT la relecture des événements
  (`charger()`) et `onUpdated()`, donc le bouton redevenait cliquable pendant la relecture qui suit
  une transmission réussie — une seconde transmission de la même facture, avant même que la première
  se soit reflétée à l'écran. Le correctif de cette branche fermait déjà cette fenêtre (le `finally`
  enveloppe tout le corps), mais **aucun test ne la gardait** : le cas « reste verrouillé pendant la
  relecture » a été reporté ici à la fusion du 25/09/2026, et rétablir le relâchement prématuré ne
  fait tomber QUE lui — aucun des quatre autres ne sépare ces deux placements. La version de `main`
  n'avait pas le `catch` : une exception y sortait du gestionnaire de clic sans aucun message, c'est
  donc le code de cette branche qui a été gardé.
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
  (`DossierTab`, src/components/DossierParcours.tsx) : **17 onglets routables, 16 testés** — banque,
  documents, statistiques, écritures, clôture, checklist, justificatifs, packs, informations,
  suppléments, accès, immobilisations, estimation (21/09/2026), financement (22/09/2026),
  cotisations et virements (23/09/2026) — donc **1 seul sans aucun test de rendu** : factures.
  Suppléments, Accès, Immobilisations, Estimation, Financement et Cotisations y sont entrés comme
  Informations : par un défaut trouvé, jamais par méthode. DIX CARTES et modales sont testées en plus, hors compte d'onglets, parce qu'elles
  portent un geste qui leur est propre : `VehiculesCard`, `ImportDossierModal`, `EnvoyerEmailModal`,
  `FilCommentaires`, `BalanceCard` (20/09/2026), `FactureAvoirModal`, `PieceFormModal` et
  `SuperPdpFactureModal` (21/09/2026), `FactureFormModal` et `AjouterDocumentsModal` (23/09/2026) —
  DIX au total. **Les deux derniers ne font PAS entrer Factures dans les onglets testés** : un onglet
  n'est pas testé parce qu'une de ses modales l'est, et `FacturesTab` lui-même reste le seul des dix-sept
  sans test de rendu. Un onglet n'est donc pas « testé » parce qu'une
  de ses cartes l'est : Informations est resté dans les non-testés jusqu'à ce qu'il gagne son propre
  test de rendu, le 21/09/2026, sur ce que la suppression d'un dossier laisse dans le stockage.
  **La liste des dossiers a rejoint les écrans testés le 20/09/2026** (`DossiersList.test.tsx`) :
  ni un onglet ni une carte mais une PAGE, donc le compte des 17 onglets ne bouge pas.
  **ET `ClientHome` LE 22/09/2026 — le premier écran CLIENT à recevoir un test de rendu**, également
  une PAGE, donc le compte ne bouge pas davantage. Il y entre par le défaut qui coûtait le plus cher
  de sa famille : au passage d'une année, cet écran annonçait « Relevés bancaires » avec RIEN à
  envoyer. **Six mutations, toutes mordent**, et la discrimination est le résultat : celle qui
  dés-APPARIE l'année du compte de mois — le défaut d'origine — fait tomber les CINQ tests, tandis
  que « la clôture n'est plus lue » et « la réserve est avalée » n'en font tomber qu'un chacune,
  exactement celui écrit pour elles. **Le doublage d'`AuthContext` est le même que celui de
  `PiecesTab`** (monter un `AuthProvider` complet ferait dépendre le test d'une session Supabase), et
  l'écran a besoin d'un `MemoryRouter`, ses tuiles portant des `Link`.
  **ET LA COQUE LE 25/09/2026 (`Layout.test.tsx`)** — ni onglet, ni carte, ni page : le compte des
  17 onglets ne bouge pas. Quatorze tests sur la barre latérale, seize mutations, toutes mordent —
  dont la liste tronquée ou refusée qui se tairait, la recherche qui exigerait les accents, l'écran
  affiché que la barre ne désignerait plus, et la relecture en boucle sur un dossier introuvable
  (garde retirée, React lève « trop de rendus »). Trois de plus dans `DossiersList.test.tsx` gardent
  ce qui relie les deux écrans : `?nouveau=1` ouvre le formulaire, et la création prévient la barre.
  **ET LE PANNEAU DE DROITE, LE MÊME JOUR** — quinze tests, quatorze mutations, toutes mordent.
  `PanneauDroit.test.tsx` garde le mécanisme (volet vide sans enfant, contenu rendu DANS le volet et
  non à l'endroit où l'écran le déclare, un seul contenu à la fois, un contenu remplacé qui en se
  fermant n'emporte pas son remplaçant, levée hors de la coque) ; `AssistantDossier.test.tsx`
  l'assistant (bouton d'en-tête enfoncé tant qu'il occupe le volet, bulle mobile sur le même volet,
  l'historique du fil envoyé à l'agent, lecture partielle dite) et surtout le passage d'un dossier à
  l'autre volet ouvert — la clé retirée fait tomber deux tests, dont celui où une lecture de l'ancien
  dossier arrive APRÈS celle du nouveau ; `DossierDetail.test.tsx` enfin, la vraie page dans la vraie
  coque, garde le câblage que rien d'autre ne voit : un bouton retiré de l'en-tête, un assistant plus
  monté (le bouton s'enfoncerait sans que rien ne s'ouvre), une coque sans emplacement — et, depuis
  le même jour, l'IDENTITÉ du dossier d'un dossier à l'autre (neuf tests, voir « la barre latérale a
  rouvert une course »).
  **ET LA FICHE D'UNE PIÈCE DANS LE VOLET, LE MÊME JOUR** — dix-sept mutations, toutes mordent. La
  garde de sortie dans `PanneauDroit.test.tsx` (six cas : une garde qui refuse retient son contenu,
  qui accepte laisse passer, la croix y passe aussi, celle d'un contenu parti ne retient pas son
  successeur, se rouvrir ne la consulte pas, l'emplacement porte le nom de son occupant) ; le
  parcours dans `PiecesTab.test.tsx`, qui monte désormais l'onglet DANS la coque du panneau (onze cas :
  la fiche de la ligne cliquée et sa place dans la liste, précédent et suivant bornés à la liste
  affichée, la saisie qui ne part pas sans un mot par « suivant », par une autre ligne ou par la
  croix, l'enchaînement sur la prochaine pièce à valider et la fermeture quand il n'y en a plus, le
  brouillon qui ferme sans demander d'abandonner ce qu'il vient d'enregistrer, la navigation grisée
  pendant un enregistrement, la pièce supprimée qui emporte sa fiche, et la validation qui répond
  pour une pièce déjà quittée). La discrimination est le résultat : retirer la CLÉ par pièce fait
  tomber trois tests, dont celui où la suivante reprenait la saisie de la précédente ; le code TEL
  QU'IL ÉTAIT (valider ferme au lieu d'enchaîner) en fait tomber deux. `FichePiece.test.tsx` garde
  toujours le verrou d'enregistrement, inchangé.
  **ET LE RAPPROCHEMENT D'UN MOUVEMENT DANS LE VOLET, LE MÊME JOUR** — `BanqueTab.test.tsx` monte à son
  tour l'onglet dans la coque du panneau, et gagne quatorze cas : l'association qui RESTE sur le
  mouvement dans son nouvel état, la ligne ouverte surlignée, les signaux dits et ceux que la banque ne
  confirme pas, deux pièces qui conviennent aussi bien montrées toutes les deux, le choix à la main qui
  n'agit qu'au clic, trois clics qui n'associent qu'une fois, le verrou partagé dans les deux sens, le
  verrou tenu pendant la relecture, un refus dit, « Suivant » après une association, un mouvement
  ignoré remis à traiter, et le règlement par « Tout rapprocher ». Quinze mutations, toutes mordent.
  **Piège de test à connaître** : un élément qui n'apparaît qu'APRÈS le chargement se cherche HORS de
  l'`act` — dedans, React retient les mises à jour jusqu'à la sortie, et `findBy…` expire sur un écran
  qui, lui, fonctionne. Le même libellé vivant aussi dans les tableaux « Sans doute possible » et « À
  trancher », une ligne du relevé se désigne par la sienne (`tr.clickable`).
  **`ClientInformations` a reçu son premier test de rendu le 25/09/2026**, par un défaut trouvé lui
  aussi : les réponses d'une société écrites dans une autre (même entrée). **Deux écrans client
  (`ClientUpload`, `ClientSimulation`) n'ont toujours aucun test de rendu** — dit plutôt que laissé
  compter : `ClientUpload` porte le MÊME câblage que `ClientHome`, donc son risque est le plus
  faible des deux maintenant que le calcul est partagé et que l'un des deux est gardé. La liste des
  dossiers, elle, y est entrée par un défaut trouvé, pas par méthode — voir « une recherche filtre
  l'affichage » plus haut.
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
  **24/09/2026 — le verrou de création d'`AccesTab`**, posé par la Routine du matin sur `main`
  (commit fa0454a) et réuni à cette branche le 25/09/2026. Son formulaire « Donner un accès client »
  ne se protégeait que par l'état React `inviting` — douzième porteur du motif « un verrou
  d'exécution est un `useRef`, jamais un état React » (voir la liste plus haut, et pourquoi la base
  ne suffisait pas). Trois tests, trois mutations, toutes mordent (verrou retiré, déplacé dans le
  `try`, non relâché dans le `finally`). **À la fusion, ses trois cas ont rejoint les six
  d'`AccesTab.test.tsx`** (lecture refusée, retrait confirmé) sur un seul faux client — et c'était à
  revérifier plutôt qu'à supposer, un faux client qui change pouvant faire passer un test pour une
  autre raison : la garde retirée fait toujours tomber exactement les deux cas du verrou.

## Tests

Vitest sur la logique métier pure de `src/lib` — 1629 tests couvrant les dates, les
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
npx tsc -p tsconfig.edge.json   # type-vérifie les Edge Functions (voir « Problèmes connus » :
                                # seul le CODE MORT y est garanti vert, le reste est annoncé)
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
- Tout déploiement d'Edge Function passe `verify_jwt` EXPLICITEMENT, à la valeur que rend
  `list_edge_functions` pour cette fonction : le paramètre a `true` pour défaut et REMPLACE la valeur
  en place quand on l'omet. Sur `receive-email` (webhook Resend, sans JWT), l'oubli coupe les e-mails
  entrants sans le moindre signal. Voir « Problèmes connus ».
- Tout nouvel appel à `supabase.functions.invoke()` doit gérer l'erreur via
  `extraireErreurFonction()`.
- Tout message d'erreur issu d'un `{ error }` Supabase passe par `messageErreur()` —
  jamais `err instanceof Error ? err.message : repli`, qui jette la raison rendue
  par Postgres (voir « Décisions techniques »). `erreursSupabase.test.ts` le vérifie
  sur toute source de production, sans exception.
- Tout nouvel onglet de dossier doit être ajouté à `TABS_VALIDES` dans
  `DossierDetail.tsx` et à `GROUPES_PARCOURS` dans `lib/ongletsDossier.ts` pour être
  routable et apparaître dans les deux navigations (barre latérale, barre d'onglets).
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
- **`main` reste linéaire** : `git rev-list --count --merges origin/main` doit rester à 0 — rebase
  ou avance rapide, jamais de commit de fusion. Une branche qui a fusionné `main` en elle pour
  résoudre une divergence ne se pousse donc pas telle quelle : on REJOUE ses commits à la suite de
  `main`, puis un dernier commit ramène l'arbre à celui de la branche vérifiée. **L'égalité des
  arbres (`git rev-parse HEAD^{tree}`) se contrôle avant de pousser** : c'est elle qui garantit que
  ce qui part en production est exactement ce que la barrière a vérifié, et non une résolution de
  conflits refaite à l'aveugle par le rejeu.
- **La Routine quotidienne « avancer un chantier » (`trig_011WworgC5Yw9whbjhNq8WA5`) est DÉSACTIVÉE
  depuis le 25/09/2026, par décision du cabinet.** Elle poussait directement sur `main` pendant
  qu'une session travaillait sur sa branche, et les deux ne se voyaient pas : la branche a fini par
  porter 88 commits absents de `main`, et la Routine a refait les 23 et 24/09 une partie de ce que la
  branche avait déjà. C'est la règle précédente prise par le côté qu'elle ne couvrait pas — pas deux
  écrivains sur une même branche, mais deux écrivains dont l'un pousse sur `main` et l'autre sur une
  branche qui doit y finir. **Et pendant ce temps la production était DÉCALÉE** : les Edge Functions
  et les migrations, déployées par MCP depuis la branche, tournaient en avance sur les écrans, qui ne
  partent que de `main` — une autre forme de « un commit n'est pas un déploiement ». La réactiver
  est une décision du cabinet, à prendre en disant qui écrit sur `main`.
- Avant de supprimer une table jugée morte, réunir les six preuves plutôt
  qu'une seule : 0 ligne, 0 clé étrangère entrante, 0 vue dépendante, 0
  trigger, 0 fonction la mentionnant (`pg_proc.prosrc`), 0 référence dans le
  code (front **et** Edge Functions). Et surtout distinguer « vide » de
  « morte » : une table vide alors que la fonctionnalité qu'elle sert a
  réellement tourné est contournée ; une table vide parce que rien ne l'a
  encore exercée ne prouve rien.
