# Diagnostic de configuration de l'agent de fond

Exécuté le 2026-09-18, en session Claude Code distante, sans aucune
intervention humaine.

## 1. Dépôt

- **Chemin absolu** : `/home/user/jd-precompta`
- **Commit court de `main`** : `4d66668` — « L'autorisation permanente couvre
  enfin ce qui demandait vraiment »
- **HEAD de la session** : `38d3e03` — « Le même serveur Supabase porte deux
  noms selon la session », en `HEAD` détaché.

À noter : `38d3e03` **n'est pas un ancêtre de `main`** (`git merge-base
--is-ancestor` le refuse). Les deux commits divergent ; la branche de ce
diagnostic part donc de `38d3e03`, l'état réellement présent sur le disque,
et non de `main`.

## 2. Connecteurs

| Connecteur | Verdict | Détail |
| --- | --- | --- |
| Supabase | **DISPONIBLE** | `execute_sql` sur `mztayrhfgtsfjqighlue`, `select count(*) as pieces from pieces;` → `[{"pieces":76}]` |
| Notion | **DISPONIBLE** | `notion-fetch` sur `dada9dc7-7a05-4637-bb3f-efb90cfb978a` → data source « Feuille de route — du premier commit au cabinet autonome », schéma complet rendu (Chantier, Domaine, Phase, État, Effort, Priorité, Ordre, Quand / ce qui bloque) |
| GitHub | **DISPONIBLE** | `mcp__github__get_me` → `login: gremtek13`, id `301798782`, 2 dépôts publics |

Aucune autorisation n'a été demandée pour l'un de ces trois appels.

Les outils Supabase, Notion et GitHub ne figuraient pas dans la liste
initiale : ils sont différés. `ToolSearch` les a chargés sans blocage
(`select:mcp__198e5dbe-…__notion-fetch` pour Notion, recherche par mots-clés
pour les deux autres).

Observation de fonctionnement, sans conséquence ici : les serveurs MCP se sont
déconnectés puis reconnectés en cours de session (un message d'ambiance a
annoncé 315 outils différés indisponibles, puis de nouveau disponibles). Les
appels effectués avant et après la reconnexion ont tous abouti.

## 3. Barrière de qualité

- `npx tsc -b` — **succès**, code de sortie 0, aucune sortie.
- `npm test` — **succès**, 45 fichiers de test, **680 tests passés**, 0 échec,
  durée 3,40 s, sous `TZ=Europe/Paris`.

**Un préalable non évident** : au premier essai, `npx tsc -b` a échoué avec
`error TS2688: Cannot find type definition file for 'vite/client'` et la même
erreur pour `'node'`. Cause : `node_modules` était **absent** du conteneur au
démarrage de la session. Un `npm ci` a suffi ; les deux commandes passent
ensuite. Ce n'est pas un blocage d'autorisation, mais c'est la première chose
qui arrêterait un agent de fond lancé sans installation préalable — et l'erreur
ne dit pas « dépendances manquantes », elle parle de définitions de types.

## 4. Autorisations demandées

**Aucune.** Pas un seul appel — MCP, `Bash`, `Write`, `git` — n'a déclenché de
demande de validation humaine. La liste d'autorisations corrigée en `38d3e03`
couvre bien les deux noms d'enregistrement du serveur Supabase.
