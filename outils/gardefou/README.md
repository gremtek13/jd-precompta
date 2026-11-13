# Le garde-fou de MVP-D9 — préparé, PAS branché

Quand la base portera les données réelles d'un premier praticien (vers le 20 novembre 2026), les migrations, les
déploiements et toute écriture en base attendent le bouton du cabinet ; les lectures partent seules. C'est la
recommandation de MVP-D9, que le cabinet a reportée au 20 novembre : **rien ici n'est branché** tant qu'il ne l'a pas
accordé (fiche MVPD9-Q1). `.claude/settings.json` ne nomme pas ce programme.

`lectureSeule.mjs` lit chaque requête de l'outil `execute_sql` avant son départ (un hook PreToolUse de Claude Code) et
ne laisse partir seule qu'une LECTURE SIMPLE. Son test : `src/lib/gardefouLectureSeule.test.ts`.

## Ce qui part seul

Une requête PROUVÉE lecture simple : une seule instruction, qui commence par `select`, `with … select`, `values`,
`table`, `show` ou `explain` (sans `analyze`), sans aucun mot qui écrit ou verrouille hors d'un littéral, et dont chaque
fonction est dans la liste fermée des fonctions sans effet (agrégats, chaînes, dates, `md5`, JSON, catalogue
`pg_get_*`, `to_reg*`, `has_*_privilege`, `current_setting`…).

Les contrôles de tous les jours passent ainsi, et le test l'exige en les lisant depuis leurs fichiers : la dérive
(`supabase/schema/README.md`), `socle.sql`, `inventaire.sql`, `signature.sql`, `bornesStockage.sql`.

## Ce qui attend le bouton

- Toute autre requête, avec sa raison dans la demande : plusieurs instructions ; `insert`, `update`, `delete`, `merge`,
  y compris dans un `with` ; `select … into` ; `for update`, `for share` ; `explain analyze` ; `do`, `call`, `copy`,
  `set`, `lock`, `begin`… ; une fonction hors de la liste (toute fonction de `public`, `nextval`, `set_config`,
  `pg_advisory_*`, `pg_sleep`, `net.http_*`…) ; ce qui ne s'analyse pas. Les essais qui écrivent puis annulent
  (`rls.sql`, `caisse.sql`…) sont de ceux-là : un bouton par essai rejoué.
- Les migrations, les déploiements et les autres outils qui changent le projet, par des règles « ask » (ci-dessous).

Une lecture que le garde-fou ne sait pas prouver (une fonction oubliée de la liste, `) v(a, b)` écrit d'une façon qu'il
ne reconnaît pas) attend le bouton elle aussi : c'est le prix du côté fermé. Ajouter une fonction à la liste demande de
savoir ce qu'elle fait.

## Ses limites

- Il arrête une ERREUR de la session, pas un adversaire. Il lit un texte, pas la base : une vue dont la définition
  appelle une fonction qui écrit, un opérateur ou une conversion définis par quelqu'un, une fonction de `public` qui
  porterait le nom d'une fonction de la liste, une fonction appelée sans parenthèses sur une ligne lui échappent. La
  RLS, les gardes et les droits de la base restent la protection des données.
- Il ne garde que l'outil `execute_sql`. La session peut modifier ce programme ou les réglages : la règle
  `Edit(/outils/gardefou/**)` ci-dessous fait attendre le bouton pour le premier, et `.claude/` est déjà un chemin
  protégé de Claude Code. À vérifier le jour du branchement : aucune clé secrète de la base dans l'environnement de la
  session (elle n'atteint la base que par les outils).
- Il compte sur le bouton. La session tourne en mode « auto » (relevé le 13/11/2026), où la demande d'un hook et une
  règle « ask » font paraître le bouton (documentation de Claude Code). En mode `bypassPermissions`, où rien ne le
  garantit pour un hook, le garde-fou REFUSE au lieu de demander.
- Un garde-fou qui ne démarre pas ou répond mal ARRÊTE l'appel (`onFailure: "block"`, Claude Code 2.1.295 ou plus ; le
  conteneur porte 2.1.323) : si `execute_sql` est refusé pour tout, c'est lui qu'il faut regarder.

## Le bloc à poser dans `.claude/settings.json`, le jour de l'accord

À fusionner dans le fichier (la clé `hooks` à côté de `permissions`, la liste `ask` à côté de `allow`) :

```json
{
  "permissions": {
    "ask": [
      "mcp__Supabase__apply_migration",
      "mcp__Supabase__deploy_edge_function",
      "mcp__Supabase__create_edge_function_secret",
      "mcp__Supabase__create_branch",
      "mcp__Supabase__delete_branch",
      "mcp__Supabase__merge_branch",
      "mcp__Supabase__rebase_branch",
      "mcp__Supabase__reset_branch",
      "mcp__Supabase__create_project",
      "mcp__Supabase__pause_project",
      "mcp__Supabase__restore_project",
      "mcp__Supabase__create_notebook",
      "mcp__Supabase__run_notebook",
      "mcp__Supabase__delete_notebook",
      "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__*",
      "Edit(/outils/gardefou/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__Supabase__execute_sql",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/outils/gardefou/lectureSeule.mjs"],
            "onFailure": "block",
            "timeout": 20
          }
        ]
      }
    ]
  }
}
```

`execute_sql` n'entre PAS dans la liste « ask » : une règle « ask » l'emporte sur l'accord d'un hook, et les lectures
attendraient aussi. Le serveur sous son ancien nom (`mcp__c03fbb34…`) attend le bouton pour tout.

## Ce que le resserrement retire

Ces lignes sortent de la liste « allow » — aujourd'hui, elles laissent partir sans bouton TOUT outil Supabase, écritures,
migrations et déploiements compris :

```json
{
  "retirer_de_allow": [
    "mcp__Supabase",
    "mcp__Supabase__execute_sql",
    "mcp__Supabase__apply_migration",
    "mcp__Supabase__deploy_edge_function",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__execute_sql",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__apply_migration",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__deploy_edge_function",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__get_edge_function",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__list_edge_functions",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__list_tables",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__list_extensions",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__list_migrations",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__get_advisors",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__query_logs",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__get_project_url",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__get_publishable_keys",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__generate_typescript_types",
    "mcp__c03fbb34-0dd1-4eb4-bbb2-4da37a0adbc2__search_docs"
  ]
}
```

Ce que le cabinet y perd, en clair : la session ne passe plus seule une migration, ne déploie plus seule une Edge
Function, n'écrit plus seule en base (un essai rejoué en production compris), ne touche plus seule aux branches, aux
secrets ni au projet. Ce qui reste sans bouton : les lectures simples par `execute_sql`, et les onze outils de lecture
déjà nommés un par un (`list_tables`, `list_migrations`, `get_advisors`, `query_logs`, `get_edge_function`…). Rien ne
change pour le dépôt, GitHub ni Notion : MVP-D9 porte sur la base.

## L'épreuve, avec le cabinet, avant le 20 novembre

Sur des requêtes sans conséquence, le bloc posé et la session relancée :

1. `select 1` par `execute_sql` : part seule, aucun bouton.
2. `select set_config('jd.epreuve', 'oui', true)` : le bouton paraît, avec la raison (« la fonction set_config… »). Le
   cabinet refuse : rien ne part. Il la rejoue et accepte : elle part, et ne change rien (un réglage qui ne vit que le
   temps de la requête).
3. `apply_migration` avec `select 1` : le bouton paraît, le cabinet REFUSE, rien ne part. (S'il ne paraissait pas, une
   ligne d'historique sans effet serait posée : son fichier rejoindrait l'export, et le branchement serait à revoir.)
4. La dérive et l'inventaire, rejoués : ils partent seuls.

Si un bouton ne paraît pas à l'étape 2 ou 3, le resserrement n'est pas en place : on le dit, on ne le suppose pas.

## Revenir en arrière

Retirer la clé `hooks` et la liste `ask`, remettre les lignes retirées de « allow ». Le programme et son test restent.
