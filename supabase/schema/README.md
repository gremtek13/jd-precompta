# Export du schéma — à relire, jamais à croire sur parole

Les 66 migrations du projet Supabase `mztayrhfgtsfjqighlue`, une par fichier, dans l'ordre de leur
application. Ce sont les instructions exactes telles que la base les a enregistrées — pas une
reconstitution, pas un `pg_dump` réarrangé.

## Pourquoi ce dossier existe

Le plan de reprise (`PLAN_DE_REPRISE.md`) nommait sa propre faiblesse principale : le schéma ne
vivait que dans l'historique des migrations du projet Supabase, qui disparaît avec lui. Sur une base
entièrement neuve, il n'y avait donc rien à appliquer — on aurait eu les données sans la forme pour
les recevoir. C'est cette faiblesse-là que ce dossier ferme.

## Ce que ce dossier N'EST PAS

**La source de vérité reste la base.** Les migrations continuent de s'appliquer par l'outil MCP
Supabase (`apply_migration`), jamais depuis ces fichiers, et il n'y a pas de Supabase CLI dans ce
dépôt. Un fichier ajouté ici n'applique rien ; une migration appliquée là-bas n'apparaît pas ici
toute seule.

Un export qui dérive en silence serait pire que pas d'export : on croirait pouvoir reconstruire, et
on découvrirait le trou le jour où il coûte le plus cher. D'où le contrôle ci-dessous.

## Vérifier qu'il n'a pas dérivé, et le régénérer

Le contrôle tient en une requête. Elle rend une ligne par migration, empreinte et nom :

```sql
select md5(rtrim(array_to_string(statements, E'\n'), E'\n') || E'\n') || '  ' || version || '_' || name
from supabase_migrations.schema_migrations order by version;
```

Et la même empreinte, côté dépôt :

```bash
cd supabase/schema
for f in *.sql; do printf '%s  %s\n' "$(md5sum "$f" | cut -c1-32)" "${f%.sql}"; done | sort -k2
```

Les deux listes doivent coïncider exactement — même nombre de lignes, mêmes empreintes. Le `rtrim`
puis le `\n` ajouté d'un côté, la convention « un fichier texte se termine par exactement un saut de
ligne » de l'autre : les deux se comparent sur le contenu, pas sur un espace de fin.

### Le raccourci : UNE valeur à comparer plutôt que cinquante-six

Comparer 56 lignes à l'œil est exactement le genre de vérification qu'on finit par survoler — et une
vérification survolée vaut zéro. L'empreinte AGRÉGÉE rend un seul nombre de chaque côté :

```sql
select count(*) as migrations,
       md5(string_agg(md5(rtrim(array_to_string(statements, E'\n'), E'\n') || E'\n') || '  ' || version || '_' || name,
                      E'\n' order by version)) as empreinte_globale
from supabase_migrations.schema_migrations;
```

```bash
cd supabase/schema
for f in $(ls *.sql | sort); do printf '%s  %s\n' "$(md5sum "$f" | cut -c1-32)" "${f%.sql}"; done \
  | head -c -1 | md5sum | cut -c1-32
```

**Le `head -c -1` n'est pas un détail, c'est LE piège de ce raccourci** : `string_agg` joint sans
saut de ligne final, la boucle shell en pose un. Sans lui les deux empreintes diffèrent toujours, et
on conclut à une dérive qui n'existe pas — ce qui est la pire issue possible pour un contrôle, parce
qu'on cesse alors de le croire. Vérifié en s'y faisant prendre.

Les deux empreintes égales ⇒ aucune dérive, et on n'a lu que deux chaînes. Elles diffèrent ⇒ on
déroule la comparaison ligne à ligne ci-dessus pour savoir LAQUELLE a bougé.

Pour régénérer un fichier absent ou divergent, lire son SQL et le réécrire tel quel :

```sql
select array_to_string(statements, E'\n')
from supabase_migrations.schema_migrations where version = '<version>';
```

**Vérifié par empreinte le 29/09/2026** : 66 fichiers, 66 migrations, empreinte globale
`69e4b1fed6b35d0cc1af81843e000853` des deux côtés, aucune divergence.

## CE QUE CETTE EMPREINTE PROUVE, ET CE QU'ELLE NE PROUVE PAS

Elle compare les **fichiers** aux **migrations**. Elle ne dit rien de ce que les migrations
**reconstruisent** — et c'est une distinction qui a coûté cher.

**Mesuré le 22/09/2026** : l'historique de migrations ne porte que **30 `create table` pour 41
tables**. Douze tables ont été créées hors `apply_migration` (éditeur SQL, `execute_sql`) et
n'existaient donc dans aucun fichier — parmi elles `lignes_bancaires`, la plus grosse table du
projet, et `ecritures_brouillon`, le cœur comptable dont sortent le FEC et la balance. L'empreinte
était verte pendant tout ce temps, parce qu'elle répondait à une autre question que celle qu'on lui
posait. Une vérification qui prouve une chose plus faible que celle qu'on lui prête est la panne que
ce dépôt connaît sous plusieurs noms ; celle-ci portait sur le plan de reprise.

Le trou est comblé par le **socle**, deux instantanés du schéma vivant générés depuis `pg_catalog`.
Ils vivent dans un SOUS-DOSSIER pour rester hors de l'empreinte ci-dessus, qui ne balaie que
`supabase/schema/*.sql` : ce ne sont pas des migrations, ils ne figurent pas dans l'historique, et ils
ne s'appliquent pas tout seuls.

- **`socle/1_tables_sans_migration.sql`** — les douze tables, avec leurs contraintes, index, RLS et
  policies.
- **`socle/2_objets_sans_migration.sql`** — **le second trou, trouvé le 29/09/2026** : six colonnes et
  cinq objets ajoutés hors `apply_migration` à des tables que les migrations CRÉENT. La table était
  dans l'export, une partie d'elle non — dont `categories.compte_comptable` et `poste_2035` (les deux
  portes vers l'écriture et la 2035), `pieces.storage_hash` (l'empreinte du dédoublonnage et de la
  piste d'audit), `dossiers.assujetti_tva` et l'adresse de collecte par e-mail. Le premier fichier ne
  pouvait pas les voir : il ne regardait que les tables absentes des migrations.

Quatre contrôles les tiennent, et aucun ne remplace les autres :

- **`supabase/essais/socle.py` + `socle.sql`** — rejouent la génération depuis la base et comparent
  le socle au caractère près (71 instructions, empreinte `2dda522afbd7f9e67e40af530be52e24` le
  29/09/2026), à une conversion près, dite dans les deux fichiers : les fins de ligne `\r\n` d'un
  corps de fonction.
- **`supabase/essais/inventaire.py` + `inventaire.sql`** — comparent NOM PAR NOM tout le catalogue à
  ce que l'export reconstruit : colonnes, contraintes, index, déclencheurs, policies, fonctions, RLS
  (781 objets, empreinte `ac9a24eaea4d64c0a5bb017121468040` le 29/09/2026). C'est le seul qui voie un
  objet créé hors migration ET hors socle, donc celui qui a trouvé le second trou. Il compare des
  noms, pas des définitions : un type, une policy ou un corps de fonction changés hors migration lui
  échappent.
- **`src/lib/sauvegardeTables.test.ts`** — refuse, à chaque build, qu'une table du schéma manque au
  plan de sauvegarde ou l'inverse. C'est lui qui aurait attrapé `exercices_clotures`, créée le matin
  même et absente des trois sites de `sauvegarde.ts`.
- **`src/lib/sauvegardeRelations.test.ts`** — refuse, à chaque build, que le graphe de la sauvegarde
  (`RELATIONS`) diffère des clés étrangères de l'export, action à la suppression comprise. C'est en
  l'écrivant que le second trou est apparu : la clé de `pieces.sous_dossier_id` n'existait dans aucun
  fichier.

Les deux essais se rejouent à la main après toute migration : la CI n'a pas accès à la base.

## Restaurer un schéma à partir d'ici — CE QUI N'A JAMAIS ÉTÉ FAIT

**L'export n'a jamais été rejoué dans une base vide, et l'ordre écrit ici jusqu'au 29/09/2026
ÉCHOUE** — constaté en le lisant, pas en le rejouant. « Les migrations dans l'ordre de leur nom, puis
le socle » bute dès `20260904160206`, qui pose une policy sur `references_annuelles`, une table que
seul le socle crée ; puis sur `multi_cabinet_rls`, qui vise les douze tables du socle ; puis sur
`20260905064432`, qui modifie `generate_code_email`, que seul le complément crée. L'ordre inverse ne
tient pas davantage : le socle est un instantané d'aujourd'hui, et il porte déjà ce que des migrations
ajoutent ensuite.

Ce que ce dossier garantit est donc plus faible que ce qu'il promettait : **tout ce que la base
contient s'y trouve, nom par nom** (contrôles ci-dessus) — pas encore une procédure qui le rejoue.
Aujourd'hui il faudrait intercaler à la main, erreur par erreur : une reprise faite ainsi un jour de
panne est précisément ce qu'un plan de reprise existe pour éviter. Rejouer l'export dans une base vide
et en tirer un ordre qui passe est un chantier inscrit à la feuille de route, différé comme le reste
de la disponibilité (décision du cabinet, 25/09/2026).

Deux choses que ces fichiers ne recréent pas, et qu'il faut avoir sous la main avant :

- **les comptes `auth.users`**, avec leurs UUID d'origine — plusieurs migrations posent des clés
  étrangères vers eux, dont quatre en NOT NULL ;
- **les secrets et l'extension `pg_net`** selon ce que l'hébergeur fournit par défaut.

Le reste est dans `PLAN_DE_REPRISE.md`.
