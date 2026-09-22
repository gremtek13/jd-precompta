# Export du schéma — à relire, jamais à croire sur parole

Les 57 migrations du projet Supabase `mztayrhfgtsfjqighlue`, une par fichier, dans l'ordre de leur
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

**Vérifié par empreinte le 22/09/2026** : 58 fichiers, 58 migrations, empreinte globale
`d2a7eaa33d6fef10480b2aa8ea540c09` des deux côtés, aucune divergence.

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

Le trou est comblé par **`socle/tables_sans_migration.sql`**, un instantané du schéma vivant généré
depuis `pg_catalog` — tables, contraintes, index, RLS et policies. Il vit dans un SOUS-DOSSIER pour
rester hors de l'empreinte ci-dessus, qui ne balaie que `supabase/schema/*.sql` : ce n'est pas une
migration, il ne figure pas dans l'historique, et il ne s'applique pas tout seul.

Deux contrôles le tiennent, et il faut les deux :

- **`supabase/essais/socle.py` + `socle.sql`** — rejouent la génération depuis la base et comparent
  au caractère près (57 instructions, empreinte `49fc3d3c27c7229699191765fa68753d` le 22/09/2026).
  À rejouer après toute migration touchant l'une des douze tables : c'est le seul moment où ce
  fichier peut dériver, et sa dérive ne se voit nulle part ailleurs.
- **`src/lib/sauvegardeTables.test.ts`** — refuse, à chaque build, qu'une table du schéma manque au
  plan de sauvegarde ou l'inverse. C'est lui qui aurait attrapé `exercices_clotures`, créée le matin
  même et absente des trois sites de `sauvegarde.ts`.

## Restaurer un schéma à partir d'ici

Appliquer les fichiers dans l'ordre de leur nom (`apply_migration`, un par un — ils se suivent :
plusieurs suppriment et recréent ce que les précédentes ont posé, et les rejouer dans le désordre ne
donnerait pas le même schéma).

Deux choses qu'ils ne recréent pas, et qu'il faut avoir sous la main avant :

- **les comptes `auth.users`**, avec leurs UUID d'origine — plusieurs migrations posent des clés
  étrangères vers eux, dont quatre en NOT NULL ;
- **les secrets et l'extension `pg_net`** selon ce que l'hébergeur fournit par défaut.

Le reste est dans `PLAN_DE_REPRISE.md`.
