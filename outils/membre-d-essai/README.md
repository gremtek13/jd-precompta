# Le membre d'équipe d'essai, en production (ESSAIS-Q1)

Décision du cabinet du 16/11/2026 : « (A) Créer le compte d'essai en production ». Les essais de `supabase/essais/` joués
en production qui ont besoin d'un simple membre de l'équipe — `repriseEtModeleComptable.sql`, `accesAvantLesGardes.sql` et
neuf blocs de `rls.sql` — nomment le compte `3e3b0000-0000-4000-8000-000000000001`, le comptable des répliques, qui n'existe
pas en production. Ce dossier pose ce compte tel que les répliques le portent, sans rien changer aux essais. Le récit :
HISTORIQUE.md, « 16/11/2026 — ESSAIS-Q1 : LE MEMBRE D'ÉQUIPE D'ESSAI ».

## La voie retenue : un texte à coller par le cabinet

`creer.sql`, collé dans l'éditeur SQL de Supabase, d'un seul tenant. Jamais par `apply_migration` (des lignes, pas un
schéma : une migration entrerait dans l'export, que la reprise rejoue dans une base vide), ni par `execute_sql` (une écriture
durable dans `auth` ; après MVP-D9, elle attendrait de toute façon le bouton).

Écartée : l'écran Équipe (`create-team-member`). Il ne crée qu'un compte À MOT DE PASSE, confirmé — un mot de passe tapé
dans un navigateur, que son gestionnaire peut garder —, sous un identifiant tiré au hasard : il faudrait réécrire les vingt
fichiers d'essais qui nomment le compte, `rls.sql` compris, pour qu'ils le cherchent, et les repasser au banc du leurre.

## Les étapes

1. **La session lit** (`execute_sql`, lecture simple) la requête 1 de `verifier.sql` : les colonnes de `auth.users` ce
   jour-là. Chaque colonne que `creer.sql` nomme doit y être, chaque colonne NOT NULL sans défaut doit y être nommée, aucun
   déclencheur propre au projet. Un écart : reprendre `creer.sql` avant de le présenter.
2. **Le cabinet colle** `creer.sql` (la session le lui donne dans la conversation). Il écrit trois lignes : le compte (sans
   mot de passe, adresse `membre-d-essai@essai.invalid` non confirmée, banni jusqu'en 2999), sa ligne d'équipe « comptable »
   dans le cabinet du dossier `test`, son assignation au seul dossier `test`. Ses gardes refusent un compte ou une adresse
   déjà là, un dossier `test` absent, et tout ce qui ne serait pas exactement cela : rien n'est alors écrit.
3. **Le cabinet regarde** Authentication › Users au tableau de bord : le compte y paraît, la liste s'affiche — le service lit
   la ligne.
4. **La session lit** les requêtes 2 et 3 de `verifier.sql` : le membre est ce que `creer.sql` dit (attendu : 1, vrai, vrai,
   vrai, 0, 0, 0, comptable, 1, 1, 0, 0), et aucune colonne de texte n'y est nulle là où le service en écrit une.
5. **La session rejoue** en production `repriseEtModeleComptable.sql`, `accesAvantLesGardes.sql` et `rls.sql` (par blocs) :
   ils doivent rendre ce qu'ils rendent sur la réplique.

## Ce que ce compte peut faire

Rien, hors des essais : aucune connexion possible (pas de mot de passe, une adresse qu'aucun courrier n'atteint, banni).
Les essais le jouent en se faisant passer pour lui dans une transaction qu'ils annulent. Il ne gère que le dossier fictif
`test`, et ne s'assigne jamais à un dossier réel ; dans la liste de l'équipe, son adresse dit ce qu'il est.

## Le retirer

Avec le dossier `test` (MVP-D8 le garde tant que les essais se rejouent en production), ou plus tôt sur décision du
cabinet : Authentication › Users › « Delete user », ou `retirer.sql` (destructif ; ses gardes refusent un compte dont on a
changé la nature). Les clés en cascade emportent sa ligne d'équipe et son assignation. MVP-D9 ne change rien au compte : le
resserrement porte sur ce que la session peut écrire seule.
