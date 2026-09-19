# Export du schéma — à relire, jamais à croire sur parole

Les 54 migrations du projet Supabase `mztayrhfgtsfjqighlue`, une par fichier, dans l'ordre de leur
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

Pour régénérer un fichier absent ou divergent, lire son SQL et le réécrire tel quel :

```sql
select array_to_string(statements, E'\n')
from supabase_migrations.schema_migrations where version = '<version>';
```

**Vérifié par empreinte le 18/09/2026** : 54 fichiers, 54 migrations, aucune divergence.

## Restaurer un schéma à partir d'ici

Appliquer les fichiers dans l'ordre de leur nom (`apply_migration`, un par un — ils se suivent :
plusieurs suppriment et recréent ce que les précédentes ont posé, et les rejouer dans le désordre ne
donnerait pas le même schéma).

Deux choses qu'ils ne recréent pas, et qu'il faut avoir sous la main avant :

- **les comptes `auth.users`**, avec leurs UUID d'origine — plusieurs migrations posent des clés
  étrangères vers eux, dont quatre en NOT NULL ;
- **les secrets et l'extension `pg_net`** selon ce que l'hébergeur fournit par défaut.

Le reste est dans `PLAN_DE_REPRISE.md`.
