# Export du schéma — à relire, jamais à croire sur parole

Les 116 migrations du projet Supabase `mztayrhfgtsfjqighlue`, une par fichier, dans l'ordre de leur
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
select md5(rtrim(replace(array_to_string(statements, E'\n'), E'\r\n', E'\n'), E'\n') || E'\n') || '  ' || version || '_' || name
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

**Et une seule conversion, les fins de ligne `\r\n` ramenées à `\n`, côté base.** Une migration que le
cabinet colle dans l'éditeur SQL de Supabase (quand `apply_migration` attend une confirmation qui
n'arrive pas) peut y arriver avec des fins de ligne `\r\n` : c'est ce qui s'est passé le 06/10/2026
pour `compte_de_bilan_du_releve`, dont le texte enregistré ne diffère du fichier que par là — vérifié
ligne à ligne, 235 lignes —, puis pour `liquidation_de_la_tva` (621 lignes, même empreinte une fois les
fins de ligne ramenées à `\n`). L'historique garde ce qui s'est réellement exécuté, et le fichier du dépôt
reste en `\n` : un retour chariot dans un fichier du dépôt ne survivrait pas au premier éditeur (la
même règle que pour le corps de `generate_code_email` dans le socle). Les 84 migrations d'avant n'en
contiennent aucun : la conversion ne change pas leur empreinte (`168bbdce…` avec et sans elle).

### Le raccourci : UNE valeur à comparer plutôt que cinquante-six

Comparer 56 lignes à l'œil est exactement le genre de vérification qu'on finit par survoler — et une
vérification survolée vaut zéro. L'empreinte AGRÉGÉE rend un seul nombre de chaque côté :

```sql
select count(*) as migrations,
       md5(string_agg(md5(rtrim(replace(array_to_string(statements, E'\n'), E'\r\n', E'\n'), E'\n') || E'\n')
                      || '  ' || version || '_' || name, E'\n' order by version)) as empreinte_globale
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
select replace(array_to_string(statements, E'\n'), E'\r\n', E'\n')
from supabase_migrations.schema_migrations where version = '<version>';
```

**Vérifié par empreinte le 10/10/2026**, après `plan_comptable_des_dossiers` (ligne 43, étape PC1 ; 20 648 caractères,
empreinte `698beb34b2890f235bd801a004c86811`, le fichier égal au texte enregistré) : 110 fichiers, 110 migrations,
empreinte globale `18219c5557253791c0d31ee653f74d98` des deux côtés, aucune divergence — la base en porte alors 112 :
`pieces_hors_de_france` (ligne 28.5, étape e2) et `banque_du_client` (espace client, étape P7), appliquées par d'autres
étapes dont les fichiers voyagent avec leurs correctifs, sont écartées de la requête (`where version not in
('20261010081009', '20261010095439')`) le temps que ces fichiers rejoignent l'export ; leurs textes enregistrés sont
ceux de ces fichiers (empreintes `5f81e12e…` et `43acdab7…`). Plus tôt le même jour : 109 fichiers, 109 migrations, empreinte globale
`bca0367fd76a0f479274a8abddf7d2c9` des deux côtés, aucune divergence — rejoué après
`retrait_du_paiement_personnel` (ligne 26.6), la dernière, collée par le cabinet dans l'éditeur SQL (elle supprime des
lignes dans le corps de sa fonction) : son texte enregistré porte des fins de ligne `\r\n`, et le fichier, tiré de la
base par la requête ci-dessus, en est la conversion en `\n` (4 126 caractères, empreinte
`87853d28976cd18fc204efb4bd159f04` avec le saut de ligne final). Le 09/10/2026 : 108, `a1a29e2f0b4c5bdef3edbdec4044b0cb`,
après `droits_des_acces_clients` (espace client, étape P1 ; 9 081 caractères, empreinte `301dc1bc6629996749d8da55f3614a52`,
le fichier égal au texte enregistré), la dernière, qui suit `notes_internes_du_cabinet` (P0) et les cinq migrations du
jour (`identite_des_factures_recues`, `paiement_personnel_des_cotisations`, `revision_des_soldes`,
`compte_amortissement_meme_ventilation`, `commentaire_compte_notes_de_frais_pcg_2026`) ; toutes dans l'export.

**Rejoué le 10/10/2026 après `pieces_hors_de_france`** (ligne 28.5, étape e2, version `20261010081009`) :
108 fichiers dans l'export de cette étape, empreinte `04b98b1aff5dbefc07aea42074727fe8`, égale à celle
des migrations de la production privée de `droits_des_acces_clients` (`20261009224031`) et de
`retrait_du_paiement_personnel` (`20261010071154`) — deux migrations d'autres chantiers, appliquées la
veille au soir et le matin même, que leurs auteurs ajoutent à l'export ; la production en porte alors
110 (empreinte globale `4d2d9d78fca8dadf3d40ba5985886f1a`), et l'égalité des 110 se rejoue quand les
trois fichiers sont réunis.

**Rejoué le 10/10/2026 après `banque_du_client`** (espace client, étape P7, version `20261010095439`) :
111 fichiers, empreinte globale `672fb2ee33556d0e19e8ec20e1a3c025`, égale à celle des migrations de la
production privée de `plan_comptable_des_dossiers` (`20261010092601`, chantier PC1, appliquée le matin
même, que son auteur ajoute à l'export) ; la production en porte 112 (empreinte globale
`0a4e465a1faa75132de290bc53aa1cc9`), égale aux fichiers une fois le sien réuni. Le fichier est le texte
enregistré (23 337 caractères, aucun retour chariot, empreinte `43acdab78bd45c77872a10de646bfd9e` avec le
saut de ligne final).

**Rejoué le 10/10/2026 après `lectures_bancaires_au_droit_banque`** (espace client, étape P7, la seconde
migration, version `20261010115358`) : 113 fichiers, empreinte globale `1a365b20ed384b7be186dad6f43564c0`,
égale à celle des migrations de la production privée de `revision_des_cycles` (`20261010110733`, ligne 41,
étape R4, appliquée trois quarts d'heure plus tôt, que son auteur ajoute à l'export) ; la production en
porte 114 (empreinte globale `73b955fc8e4847365c0ccc3b128c45fb`), égale aux fichiers une fois le sien
réuni. Le fichier est le texte enregistré (3 398 caractères, aucun retour chariot, empreinte
`26919b01787e7ce2cec59b165ebdbc71` avec le saut de ligne final).

**Rejoué le 10/10/2026 après `revision_des_cycles`** (ligne 41, étape R4, version `20261010110733`), son
fichier réuni à l'export : 114 fichiers, 114 migrations, empreinte globale
`73b955fc8e4847365c0ccc3b128c45fb` des deux côtés, aucune divergence. Le fichier est le texte enregistré,
octet pour octet (31 737 caractères, saut de ligne final compris, aucun retour chariot, empreinte
`d943dfed6d701712b5c66ec3e41bdf0a`).

**Rejoué le 10/10/2026 après `ventes_du_client` puis `ventes_du_client_facturation`** (espace client, étape P2,
versions `20261010123950` et `20261010130643`), leurs fichiers réunis à l'export : 116 fichiers, 116 migrations,
empreinte globale `deea18c0ff552ddece515c1c35e6c116` des deux côtés, aucune divergence. Le premier fichier est le texte
enregistré, octet pour octet (34 959 caractères, saut de ligne final compris, aucun retour chariot, empreinte
`e60ccc6d6386a6e9379cd640bbdb27c0`). Le second a été collé par le cabinet dans l'éditeur SQL (son texte supprime les
lignes d'une facture et un brouillon) : son texte enregistré porte 311 fins de ligne `\r\n` (17 860 caractères), et le
fichier, tiré de la base par la requête ci-dessus, en est la conversion en `\n` (17 549 caractères, saut de ligne final
compris, empreinte `db69535853d481c652dbf271254280b1`).

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
  le socle au caractère près (78 instructions, empreinte `f01053c781688bbfbee8c70ac43924a6` des
  deux côtés le 09/10/2026, rejoué à l'intégration des trois migrations du jour, puis inchangé après
  `notes_internes_du_cabinet`, `droits_des_acces_clients` et, le 10/10/2026, `retrait_du_paiement_personnel` puis
  `plan_comptable_des_dossiers`, qui ne touchent aucune table du socle ; les trois objets que
  `paiement_personnel_des_cotisations` ajoute à `cotisations_declarees` et `ecritures_brouillon`, deux
  tables du socle, y sont), à une conversion près, dite dans les deux fichiers : les fins de ligne `\r\n` d'un
  corps de fonction.
  Une contrainte ou un index qu'une MIGRATION crée sur une colonne du complément n'en fait pas partie :
  il est dans l'export, au fichier de sa migration, et la génération l'écarte en cherchant son nom dans
  l'historique. Sans cette règle, `dossiers_statut_tva_coherent` (07/10/2026), qui lie le statut de TVA
  à `assujetti_tva`, aurait été comptée deux fois.
- **`supabase/essais/inventaire.py` + `inventaire.sql`** — comparent NOM PAR NOM tout le catalogue à
  ce que l'export reconstruit : colonnes, contraintes, index, déclencheurs, policies, fonctions, RLS
  (1 430 objets dans l'export le 10/10/2026 après `plan_comptable_des_dossiers`, empreinte
  `cccfb25cfc26abe211942930a5be473b` ; elle en ajoute 38 : quatorze colonnes,
  quatorze contraintes, un index, un déclencheur, deux policies, quatre fonctions et la RLS de ses deux tables ; la base
  en compte alors 1 564, exactement l'export et les migrations des deux autres étapes du jour — `pieces_hors_de_france`
  et `banque_du_client`, rejouées depuis leurs fichiers —, empreinte `cf9ba7dbe87c1a96bc79be53c9cdee1d` des deux côtés.
  Plus tôt : 1 392 objets, empreinte `a81a947319e4f30b6e1525bdf3ce45d7` des deux côtés le 10/10/2026, rejoué après
  `retrait_du_paiement_personnel`, qui en ajoute un : sa fonction ; 1 391 avant, après `droits_des_acces_clients`,
  qui en ajoutait 7 : les deux colonnes des droits de `memberships` et cinq fonctions ;
  1 384 avant, après `notes_internes_du_cabinet`, qui en ajoutait 19 : sept colonnes, sept contraintes, un index, un
  déclencheur, une policy, une fonction et la RLS de sa table). C'est le seul qui voie un
  objet créé hors migration ET hors socle, donc celui qui a trouvé le second trou. Il compare des
  noms, pas des définitions : un type, une policy ou un corps de fonction changés hors migration lui
  échappent. Un déclencheur de CONTRAINTE (`create constraint trigger`) y compte deux fois, comme
  déclencheur et comme contrainte, parce que le catalogue le range aussi dans `pg_constraint` (type
  `t`) : le premier, `factures_emises_avoir_sans_brouillon` (07/10/2026), a d'abord fait voir 1 116
  objets en base contre 1 115 dans l'export.
- **`src/lib/sauvegardeTables.test.ts`** — refuse, à chaque build, qu'une table du schéma manque au
  plan de sauvegarde ou l'inverse. C'est lui qui aurait attrapé `exercices_clotures`, créée le matin
  même et absente des trois sites de `sauvegarde.ts`.
- **`src/lib/sauvegardeRelations.test.ts`** — refuse, à chaque build, que le graphe de la sauvegarde
  (`RELATIONS`) diffère des clés étrangères de l'export, action à la suppression comprise. C'est en
  l'écrivant que le second trou est apparu : la clé de `pieces.sous_dossier_id` n'existait dans aucun
  fichier.

Les deux essais se rejouent à la main après toute migration : la CI n'a pas accès à la base.

**Rejoués le 10/10/2026 après `pieces_hors_de_france`** (ligne 28.5, étape e2) : le socle est inchangé
(78 instructions, `f01053c781688bbfbee8c70ac43924a6` des deux côtés — la migration ne touche aucune table
du socle) ; l'inventaire compte 1 468 objets, empreinte `81cdc82ae5d44444c52c0eaad5b0d216` des deux
côtés, la production prise sans les huit objets de ces deux migrations d'autres chantiers (deux colonnes
de `memberships`, six fonctions ; 1 476 objets en tout, `8ebeee2fda0acdb92a76b43a2ebd646d`).
`pieces_hors_de_france` en ajoute 84 : trente colonnes, trente-quatre contraintes, quatre index, trois
déclencheurs, quatre policies, sept fonctions et la RLS de ses deux tables.

**Rejoués le 10/10/2026 après `banque_du_client`** (espace client, étape P7) : le socle est inchangé
(78 instructions, `f01053c781688bbfbee8c70ac43924a6` des deux côtés — la migration ne touche aucune table
du socle) ; l'inventaire compte 1 526 objets, empreinte `62a97d519c9a761311ca9834f5d5effa` des deux
côtés, la production prise sans les 38 objets de `plan_comptable_des_dossiers` (1 564 objets en tout).
`banque_du_client` en ajoute 50 : seize colonnes, douze contraintes, six index, deux déclencheurs, six
policies — dont la lecture de `controles_releves_bancaires` à la case « Banque » —, six fonctions et la
RLS de ses deux tables.

**Rejoués le 10/10/2026 après `lectures_bancaires_au_droit_banque`** (espace client, étape P7) : le socle
CHANGE, et c'est attendu — la migration réécrit la lecture des mouvements par un accès client, une policy
de `lignes_bancaires`, l'une des douze tables du socle ; sa ligne est régénérée depuis le catalogue
(`for select to authenticated`, `client_du_dossier(dossier_id, 'banque'::text)`), et les deux côtés
rendent 78 instructions, `91ae95ec73c3b7bdc9f4307b5443144f`. L'inventaire compte 1 564 objets dans les
fichiers (`cf9ba7dbe87c1a96bc79be53c9cdee1d`) : la migration n'en ajoute aucun, elle modifie trois
policies sans les renommer ; la production en porte 1 637 (`9628a4d3da780aabddc40c22569eedcf`), égale aux
fichiers une fois celui de `revision_des_cycles` réuni (ses 73 objets).

**Rejoués le 10/10/2026 après `revision_des_cycles`** (ligne 41, étape R4), son fichier réuni : le socle est
inchangé (78 instructions, `91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés — la migration ne touche aucune
table du socle) ; l'inventaire compte 1 637 objets, empreinte `9628a4d3da780aabddc40c22569eedcf` des deux
côtés. `revision_des_cycles` en ajoute 73 : vingt-sept colonnes, vingt-quatre contraintes, quatre index, trois
déclencheurs, six policies, six fonctions et la RLS de ses trois tables.

**Rejoués le 10/10/2026 après `ventes_du_client` puis `ventes_du_client_facturation`** (espace client, étape P2), leurs
fichiers réunis : le socle est inchangé (78 instructions, `91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés — les deux
migrations ne touchent aucune table du socle) ; l'inventaire compte 1 650 objets, empreinte
`a2c522361a91e2a44641098ec1e1e2c6` des deux côtés. Elles en ajoutent 13 : deux colonnes (`factures_emises.valide_par`,
`transmissions_factures.cree_par`), une contrainte, neuf policies — les lectures au droit « Ventes » — et une fonction,
`supprimer_brouillon_facture` ; les huit fonctions qu'elles réécrivent gardent leur nom, et l'inventaire, qui compare
des noms, ne les voit pas changer.

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
