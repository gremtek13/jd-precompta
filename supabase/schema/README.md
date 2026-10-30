# Export du schéma — à relire, jamais à croire sur parole

Les migrations du projet Supabase `mztayrhfgtsfjqighlue`, une par fichier, dans l'ordre de leur
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

**Rejoué le 11/10/2026 après `revue_analytique`** (ligne 41, étape R5), sur la réplique de l'étape (égale à la production
à 116 migrations, `signature.sql`, neuf familles), la migration appliquée avec sa ligne d'historique sous la version
PROVISOIRE `20261011999999` — à remplacer, nom du fichier compris, par celle que l'historique de production lui donne,
et le contrôle à rejouer en production : 117 fichiers, 117 migrations, empreinte globale
`4322160e675f10466b2ebd6eb6cf56b2` des deux côtés, aucune divergence (sans elle : 116, `deea18c0…`, la production du
jour). Le fichier est le texte appliqué, octet pour octet (40 480 caractères, 41 221 octets, saut de ligne final
compris, aucun retour chariot, empreinte `0e4c83a7bd096f96cb03475565e8ff46`) : c'est l'empreinte que la ligne
d'historique doit rendre.

**Préparé le 11/10/2026, PAS ENCORE APPLIQUÉ : `regimes_ereporting_et_pieces_ecartees`** (ligne 28.5, étape e5a). Son
fichier porte une version PROVISOIRE, `20261011120000` : `apply_migration` lui donnera la sienne, et le fichier se
RENOMME à cette version avant la fusion — le texte ne change pas (31 067 caractères, 31 876 octets, saut de ligne final
compris, aucun retour chariot, empreinte `d26bbb0cbef54284f7894b40f1952220`), l'empreinte globale si, la version y
entrant. Sur la réplique de l'étape, égale à la production à 116 migrations (empreinte globale `deea18c0…`, ci-dessus)
puis munie de celle-ci et de sa ligne d'historique à la version provisoire : 117 fichiers, 117 migrations, empreinte
globale `efdcade0290bcb29b198bf9604f9582d` des deux côtés. Après l'application, le contrôle se rejoue contre la
production, la version réelle au nom du fichier.

**Rejoué le 11/10/2026 en production, les deux migrations appliquées** : `revue_analytique` sous la version
`20261011090828`, puis `regimes_ereporting_et_pieces_ecartees` sous `20261011091325`, leurs fichiers renommés à ces
versions, textes inchangés (`0e4c83a7…` et `d26bbb0c…`, les empreintes que rendent leurs lignes d'historique) :
118 fichiers, 118 migrations, empreinte globale `a03b7f0b653a01f7a1e9e1c79a321546` des deux côtés, aucune divergence.

**Préparé le 11/10/2026, PAS ENCORE APPLIQUÉ : `declarations_ereporting`** (ligne 28.5, étape e5b1). Son fichier porte une
version PROVISOIRE, `20261011150000` : `apply_migration` lui donnera la sienne, et le fichier se RENOMME à cette version
avant la fusion — le texte ne change pas (40 799 caractères, 41 670 octets, saut de ligne final compris, aucun retour
chariot, empreinte `3deb437355c47f1e184baa9829e0e600`), l'empreinte globale si, la version y entrant. Il ne contient
aucune instruction de suppression (`delete` n'y paraît que dans `on delete cascade`, `tg_op = 'DELETE'` et
`before … delete`) : `apply_migration` ne devrait pas attendre de confirmation. Sur la réplique de l'étape, égale à la
production à 118 migrations (empreinte globale `a03b7f0b…`, ci-dessus) puis munie de celle-ci et de sa ligne
d'historique à la version provisoire : 119 fichiers, 119 migrations, empreinte globale
`fa2c86cf48b00d6d02875f2b863aceaa` des deux côtés. Après l'application, le contrôle se rejoue contre la production, la
version réelle au nom du fichier.

**Rejoué le 11/10/2026 après `declarations_ereporting`** (ligne 28.5, étape e5b1), appliquée par la session sous la
version `20261011124310`, sans confirmation demandée ; son fichier a quitté la version provisoire pour celle-ci, texte
inchangé (`3deb4373…`, l'empreinte que rend sa ligne d'historique) : 119 fichiers, 119 migrations, empreinte globale
`29fedc2f680740d16956cecb0393b57c` des deux côtés, aucune divergence.

**Rejoué le 11/10/2026 après `la_base_lit_le_plan_1` à `_6`** (ligne 43, étape PC2), contre la production : la première
appliquée par `apply_migration` (version `20261011155133`), les cinq autres collées par le cabinet dans l'éditeur SQL,
chacune avec sa ligne d'historique (versions `20261011155350` à `20261011155446`) ; leurs fichiers portent ces versions :
125 fichiers, 125 migrations, empreinte globale `d0d719528f34fe7e1ce0443426113829` des deux côtés, aucune divergence. Les
six fichiers sont les textes enregistrés, fins de ligne ramenées à `\n` (19 227, 18 851, 15 265, 14 971, 14 847 et
15 058 caractères, saut de ligne final compris ; empreintes `85768e0b…`, `ef3bce0a…`, `128da939…`, `23816b86…`,
`7e7fa53f…` et `1f8947d5…`) : le premier l'est octet pour octet ; les cinq collés portent dans l'historique une fin de
ligne `\r\n` à chacune de leurs lignes (381, 295, 279, 286 et 294).

**Rejoué le 12/10/2026 après `dossier_permanent`** (ligne 41, étape R7), appliquée par la session sous la version
`20261012070920`, sans confirmation demandée (`delete` n'y paraît que dans `on delete cascade`, `tg_op = 'DELETE'` et
`before insert or update or delete`) ; son fichier a quitté la version PROVISOIRE `20261011999999` pour celle-ci, texte
inchangé (29 953 caractères, 30 591 octets, saut de ligne final compris, aucun retour chariot, empreinte
`7931ad9634eb96e27e0f308dffdd73a7`, celle que rend sa ligne d'historique) : 126 fichiers, 126 migrations, empreinte
globale `133cb02effac27af65c391846c60be79` des deux côtés, aucune divergence. Sur la réplique de l'étape, égale à la
production à 125 migrations (`d0d71952…`, ci-dessus) puis munie de celle-ci à la version provisoire : 126 fichiers, 126
migrations, empreinte globale `e927392aa7fc199d665b3dcbb62ac296` des deux côtés.

**Préparé le 12/10/2026, PAS ENCORE APPLIQUÉ : `bornes_du_stockage`** (ligne 22.6). Son fichier porte une version
PROVISOIRE, `20261012200000` : `apply_migration` lui donnera la sienne, et le fichier se RENOMME à cette version dans la
demande qui suit l'application — elle vient APRÈS la fusion, l'ordre est inverse de celui des autres migrations
préparées —, sans que le texte change (2 653 caractères, 2 698 octets, saut de ligne final compris, aucun retour
chariot, empreinte `c5b7acf5e028ff621d4b0813c49768da`). Aucune instruction de suppression : un bloc qui exige les trois
seaux, puis trois `update storage.buckets … where id = …` (la taille et les types de chacun) ; le rôle des migrations
(`postgres`) contourne la RLS de `storage.buckets` et a le droit d'écrire ces deux colonnes, que les déclencheurs
`protect_bucket_control_*` ne gardent pas (ils ne gardent que le cycle de vie). Elle s'applique APRÈS le déploiement de
l'application et de `receive-email` qui portent les mêmes bornes. Ni le socle ni l'inventaire ne lisent les seaux :
`supabase/essais/bornesStockage.sql` les juge, après l'application. Jusqu'à elle, l'export compte un fichier de plus que
l'historique de la production (127 pour 126).

**Rejoué le 13/10/2026 après `bornes_du_stockage`** (ligne 22.6), appliquée par la session sous la version
`20261013043646`, sans confirmation demandée (trois `update … where id = …`, aucune suppression), le lendemain du
déploiement de l'application et de `receive-email` qui portent les mêmes bornes, et après la réponse du cabinet à
S226-Q1 (20 Mio) ; son fichier a quitté la version PROVISOIRE `20261012200000` pour celle-ci, texte inchangé
(2 653 caractères, empreinte `c5b7acf5e028ff621d4b0813c49768da`, celle que rend sa ligne d'historique) : 127 fichiers,
127 migrations, empreinte globale `df2085177f71e382f8e8761b496d784d` des deux côtés, aucune divergence. Le socle (78
instructions, `91ae95ec…`) et l'inventaire (1 875 objets, `ae3d8044…`) sont inchangés, égaux des deux côtés : la
migration n'écrit que deux colonnes de trois lignes de `storage.buckets`, qu'aucun des trois contrôles ne lit ;
`supabase/essais/bornesStockage.sql` les juge, et rend « ok » à ses cinq lignes.

**Rejoué le 13/10/2026 après `pieces_jointes_ecartees`** (ligne 22.7), appliquée par la session sous la version
`20261013061933`, sans confirmation demandée (`delete` n'y paraît que dans `on delete cascade`), AVANT la fusion du
correctif qui lit la table ; son fichier a quitté la version PROVISOIRE `20261013200000` pour celle-ci, texte inchangé
(9 258 caractères, empreinte `38c6cd0fc87d17b9626c3806673cf179`, celle que rend sa ligne d'historique) : 128 fichiers,
128 migrations, empreinte globale `fba7cc1afb1e304fcdeaf7784ed3dd2e` des deux côtés, aucune divergence. Le socle est
inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 1 896 objets, `e20c0b51100a3f97348b9578afe9f69e` des deux
côtés — la migration en ajoute 21 : huit colonnes, sept contraintes, un déclencheur, deux policies, deux fonctions et la
RLS de sa table. `signature.sql` rend en production, famille par famille, ce que l'étape avait relevé sur sa réplique
après la migration (colonnes 780, contraintes 585, déclencheurs 53, fonctions 154 et leurs droits 154, index 218,
policies 145, tables 76 et leur RLS 76).

**Rejoué le 13/10/2026 après `pieces_jointes_ecartees_depot`** (ligne 22.8), appliquée par la session sous la version
`20261013103407` sur l'accord du cabinet (S228-Q1), sans confirmation demandée (le détecteur de l'outil n'a retenu ni
son `drop constraint` ni son `drop not null`), AVANT la fusion du correctif qui écrit et lit la raison `depot` ; son
fichier a quitté la version PROVISOIRE `20261013220000` pour celle-ci, texte inchangé (4 199 caractères, empreinte
`56135d38a531ed7a5b234a47c0556a0f`, celle que rend sa ligne d'historique) : 129 fichiers, 129 migrations, empreinte
globale `a33646ecf1e5ddb7202ad6d15c977ddd` des deux côtés, aucune divergence. Le socle est inchangé (78 instructions,
`91ae95ec…`) ; l'inventaire compte 1 897 objets, `a33f203240bbb9c6d9ecb40e3c384add` des deux côtés — la contrainte
`pieces_jointes_ecartees_poids_connu` en plus, la contrainte remplacée gardant son nom. `signature.sql` rend en
production ce que l'étape avait relevé sur sa réplique après la migration : seules les colonnes (780, la nullabilité du
poids) et les contraintes (586) ont changé. L'essai `supabase/essais/piecesJointesEcartees.sql`, rejoué en production
sans ses lignes de commentaire (52 511 caractères, reçus tels quels), rend ses verdicts justes, mutations comprises, et
rien n'est resté en base.

**Rejoué le 13/10/2026 après `pieces_jointes_ecartees_vide`** (ligne 22.91), appliquée par la session sous la version
`20261013121915` sur l'accord du cabinet (S229-Q1), sans confirmation demandée (le détecteur de l'outil n'a retenu aucun
de ses deux `drop constraint`), AVANT la fusion du correctif qui écrit et lit la raison `vide` ; son fichier a quitté la
version PROVISOIRE `20261013230000` pour celle-ci, texte inchangé (4 574 caractères, empreinte
`3e8799909379f895988dc4a81aed470c`, celle que rend sa ligne d'historique) : 130 fichiers, 130 migrations, empreinte
globale `cd7850e31b6d20f5859bc851f5d8dfa3` des deux côtés, aucune divergence. Le socle (78 instructions, `91ae95ec…`) et
l'inventaire (1 897 objets, `a33f2032…`) sont inchangés, égaux des deux côtés : les deux contraintes remplacées gardent
leur nom. `signature.sql` rend en production ce que l'étape avait relevé sur sa réplique après la migration : seule la
famille des contraintes a changé (586, `8b1d3543…`), les huit autres égales à celles d'avant. L'essai
`supabase/essais/piecesJointesEcartees.sql`, rejoué en production sans ses lignes de commentaire (60 892 caractères,
reçus tels quels), rend ses 57 verdicts justes, mutations comprises, et rien n'est resté en base.

**Rejoué le 13/10/2026 après `pieces_jointes_ecartees_au_client`** (ligne 22.9), appliquée par la session sous la
version `20261013174021` sur l'accord du cabinet (S228B-Q1), sans confirmation demandée (aucune suppression), AVANT la
fusion de l'écran qui la lit ; son fichier a quitté la version PROVISOIRE `20261013235000` pour celle-ci, texte inchangé
(5 751 caractères, empreinte `bd9f20870264c17ac2e0dc0535028ee1`, celle que rend sa ligne d'historique) : 131 fichiers,
131 migrations, empreinte globale `e1d6d37e8e4d6c1e19dc18b0fb43486b` des deux côtés, aucune divergence. Le socle est
inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 1 898 objets, `5535f404cd873f4c1a10278001bf3885` des deux
côtés — la fonction `pieces_jointes_ecartees_du_client` en plus. `signature.sql` rend en production ce que l'étape avait
relevé sur sa réplique après la migration : seules les fonctions (155, `e9e596fe…`) et leurs droits (155, `93544847…`)
ont changé, les sept autres familles égales à celles d'avant. L'essai `supabase/essais/piecesJointesEcartees.sql`,
rejoué en production sans ses lignes de commentaire (82 909 caractères, reçus tels quels), rend ses 81 verdicts justes,
mutations comprises, et rien n'est resté en base.

**Rejoué le 14/10/2026 après `articles`** (espace client, étape A1), appliquée par la session sous la version
`20261014063058` sur l'accord du cabinet (A1-Q1), sans confirmation demandée (aucune suppression), AVANT la mise en
ligne de la bascule qui la lit ; son fichier a quitté la version PROVISOIRE `20261014090000` pour celle-ci, texte
inchangé (20 536 caractères, empreinte `53ec69461cf88f6459ccf30ad9b29290`, celle que rend sa ligne d'historique) :
132 fichiers, 132 migrations, empreinte globale `789570a96cec5ac570ee7d1ae0fd3ea0` des deux côtés, aucune divergence. Le
socle est inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 1 932 objets, `d500773486b79a3b24e3adb38d2fe46a`
des deux côtés — la table `articles`, ses quinze colonnes, ses douze contraintes, ses trois policies, sa RLS et ses
trois fonctions en plus. `signature.sql` rend en production ce que l'étape avait relevé sur sa réplique après la
migration : huit familles changent, les déclencheurs non. L'essai `supabase/essais/articles.sql`, rejoué en production
sans ses lignes de commentaire (60 638 caractères, reçus tels quels), rend ses 159 verdicts justes, mutations comprises,
et rien n'est resté en base ; `rls.sql`, sa copie adaptée (60 193 caractères, `b49cdaf6…`), 35 lignes, 0 en faute, 33
mutations sur 33.

**Rejoué le 14/10/2026 après `adresses_reception`** (espace client, étape A6a), appliquée par la session sous la version
`20261014143141` sur l'accord du cabinet (A6-Q1), sans confirmation demandée (aucune suppression), AVANT la mise en
ligne de la bascule qui la lit ; son fichier a quitté la version PROVISOIRE `20261014160000` pour celle-ci, texte
inchangé (25 674 caractères, empreinte `bed56842e960b3b04ef6beccc137fc9e`, celle que rend sa ligne d'historique) :
133 fichiers, 133 migrations, empreinte globale `410fe6d20dea5da17d11042814d32185` des deux côtés, aucune divergence. Le
socle est inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 1 964 objets, `e21ba280643354680eda94553cfd19c3`
des deux côtés — la table `adresses_reception`, ses onze colonnes, ses onze contraintes, ses deux index, sa garde et son
déclencheur, ses trois policies, sa RLS et ses deux fonctions en plus. `signature.sql` rend en production ce que l'étape
avait relevé sur sa réplique après la migration : les neuf familles changent. L'essai
`supabase/essais/etatFactureElectronique.sql`, rejoué en production sans ses lignes de commentaire (65 027 caractères,
reçus tels quels), rend ses 129 verdicts justes, mutations comprises, et rien n'est resté en base ; `rls.sql`, sa copie
adaptée (63 449 caractères, `990deaf1…`), 35 lignes, 0 en faute, 35 mutations sur 35.

**Rejoué le 15/10/2026 après `contacts`** (espace client, étape A4a), appliquée par la session sous la version
`20261015070431` sur l'accord du cabinet (A4-Q6), sans confirmation demandée (aucune suppression), AVANT la mise en
ligne de la bascule qui la lit ; son fichier a quitté la version PROVISOIRE `20261015090000` pour celle-ci, texte
inchangé (34 682 caractères, empreinte `c3e40fea599d388822fe457b73955b6a`, celle que rend sa ligne d'historique) :
134 fichiers, 134 migrations, empreinte globale `c9cda2ac36b708e6996da2d527e2a240` des deux côtés, aucune divergence. Le
socle est inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 2 015 objets, `5f618670d9c591b1cce51e23533903ef`
des deux côtés — la table `contacts`, ses vingt et une colonnes, ses vingt-deux contraintes, ses trois policies, sa RLS
et ses quatre fonctions en plus. `signature.sql` rend en production ce que l'étape avait relevé sur sa réplique après la
migration : huit familles changent, pas les déclencheurs. L'essai `supabase/essais/contacts.sql`, rejoué en production
sans ses lignes de commentaire (86 512 caractères, reçus tels quels), rend ses 224 verdicts justes, mutations comprises,
et rien n'est resté en base ; `rls.sql`, sa copie adaptée (65 724 caractères, `0705e4a7…`), 35 lignes, 0 en faute, 37
mutations sur 37.

**Rejoué le 15/10/2026 après `importer_contacts`** (espace client, étape A4b3a), appliquée par la session sous la
version `20261015170232` sur l'accord du cabinet (A4B3-Q5), sans confirmation demandée (aucune suppression), AVANT la
mise en ligne de la bascule qui la nomme ; son fichier a quitté la version PROVISOIRE `20261015140000` pour celle-ci,
texte inchangé (8 716 caractères, empreinte `746ef49dbda068efbd09ad484d32e1b2`, celle que rend sa ligne d'historique) :
135 fichiers, 135 migrations, empreinte globale `9db4d12c2d2860d2bb10d5acfeb846a4` des deux côtés, aucune divergence. Le
socle est inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 2 016 objets, `d152ddd597f1ce7b28692bdd86b8ad88`
des deux côtés — la fonction `importer_contacts` en plus. `signature.sql` rend en production ce que l'étape avait relevé
sur sa réplique après la migration : deux familles changent, les fonctions et leurs droits. L'essai
`supabase/essais/importContacts.sql`, rejoué en production sans ses lignes de commentaire (42 036 caractères, reçus tels
quels), rend ses 73 verdicts justes, mutations comprises, et rien n'est resté en base — à son second passage : le
premier comparait un contrôle à un message que la session avait mal recopié, et sa ligne « 0 » le disait (HISTORIQUE.md,
« L'IMPORT D'UN FICHIER DE CLIENTS, EN BASE »).

**Rejoué le 16/10/2026 après `parametres_facturation`** (espace client, étape A5a), appliquée par la session sous la
version `20261016064317` sur l'accord du cabinet (A5-Q1), sans confirmation demandée (aucune suppression : le mot n'y
paraît que dans la cascade et la garde), AVANT la mise en ligne de la bascule qui la lit ; son fichier a quitté la
version PROVISOIRE `20261016080000` pour celle-ci, texte inchangé (38 450 caractères, empreinte
`4acf9cbd940ec7d5072e2a01f6c45ff7`, celle que rend sa ligne d'historique) : 136 fichiers, 136 migrations, empreinte
globale `8e9f22d28681ab79500a7016488e5d55` des deux côtés, aucune divergence. Le socle est inchangé (78 instructions,
`91ae95ec…`) ; l'inventaire compte 2 071 objets, `8ae741818f072e89fefe83835e096552` des deux côtés — la table
`parametres_facturation`, ses dix-sept colonnes, ses dix-neuf contraintes, deux index, sa garde (le déclencheur et sa
fonction), ses trois policies, sa RLS et ses deux fonctions, et les quatre colonnes de `dossiers` avec leurs cinq
contraintes, en plus (55 objets). `signature.sql` rend en production ce que l'étape avait relevé sur sa réplique après
la migration : les neuf familles changent. L'essai `supabase/essais/parametresFacturation.sql`, rejoué en production
sans ses lignes de commentaire (82 633 caractères, reçus tels quels), rend ses 204 verdicts justes, mutations comprises,
et rien n'est resté en base ; `rls.sql`, sa copie adaptée (68 363 caractères, `747866d5…`), 35 lignes, 0 en faute, 39
mutations sur 39.

**Rejoué le 17/10/2026 après `dernier_changement_de_rib`** (espace client, étape A5b3a), appliquée par la session sous
la version `20261016220724` sur l'accord du cabinet (A5B3-Q1), sans confirmation demandée (le texte ne retire rien),
AVANT la mise en ligne de la bascule qui la lit ; son fichier a quitté la version PROVISOIRE `20261016180000` pour
celle-ci, texte inchangé (14 420 caractères, empreinte `5a9dda4beb988c79dad67e2481f1c9d0`, celle que rend sa ligne
d'historique) : 137 fichiers, 137 migrations, empreinte globale `753eda2ca2dce594b5bcdacd0204108f` des deux côtés,
aucune divergence. Le socle est inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 2 072 objets,
`987a12dcc11d47b3eb310e022f989e6d` des deux côtés — la fonction, en plus. `signature.sql` rend en production ce que
l'étape avait relevé sur sa réplique après la migration : seules les fonctions (170, `56bfa578…`) et leurs droits
d'exécution (170, `0af37f59…`) changent. L'essai `supabase/essais/dernierChangementDeRib.sql`, rejoué en production sans
ses lignes de commentaire (47 554 caractères, reçus tels quels, `fecdd4f3…`), rend ses 98 verdicts justes, mutations
comprises, et rien n'est resté en base ; `rls.sql` n'a pas été rejoué en production — la migration ne pose ni table ni
policy, et la réplique l'a rendu identique sans elle et avec elle : 35 lignes, 0 en faute, 39 mutations sur 39.

**Rejoué le 17/10/2026 après `logo_des_factures`** (espace client, étape A5c1), appliquée par la session sous la version
`20261017120403` sur l'accord du cabinet (A5C-Q1), sans confirmation demandée (le mot « delete » n'y paraît que dans la
policy qui dit QUI supprime un fichier), AVANT la mise en ligne de la bascule qui la lit ; son fichier a quitté la
version PROVISOIRE `20261017120000` pour celle-ci, et il porte le texte que rend sa ligne d'historique (27 904
caractères, empreinte `ef14fed6ceb407e6598af2e06b9653b2`) — le fichier préparé moins le point-virgule final de sa
dernière instruction (un `comment on function`), omis en le transcrivant vers l'outil, sans effet sur ce que la base a
posé : 138 fichiers, 138 migrations, empreinte globale `ead3478579601fce363bdf790bfeb920` des deux côtés, aucune
divergence. Le socle est inchangé (78 instructions, `91ae95ec…`) ; l'inventaire compte 2 080 objets,
`7939e5104bf063d6faf7bf06df7cb30c` des deux côtés — les deux colonnes du logo, leurs trois contraintes et les trois
policies du seau `ventes`, en plus. `signature.sql` rend en production ce que l'étape avait relevé sur sa réplique après
la migration : les colonnes (850, `7280745b…`), les contraintes (658, `aa4ece0d…`) et les fonctions (170, `29fee672…`)
changent, ainsi que la signature du stockage (onze policies, quatre seaux). L'essai
`supabase/essais/logoDesFactures.sql`, rejoué en production sans ses lignes de commentaire (54 455 caractères, reçus
tels quels, `1c8690ba…`), rend ses 126 verdicts justes, mutations comprises, et rien n'est resté en base ; ceux que la
fonction remplacée concerne aussi : `parametresFacturation.sql` (204 verdicts) et `dernierChangementDeRib.sql` (98),
justes, et `bornesStockage.sql`, les quatre seaux « ok » ; `rls.sql`, sa copie adaptée (81 101 caractères, `506f61be…`),
46 lignes, 0 en faute, 43 mutations sur 43.

**Rejoué le 18/10/2026 après `exemplaires_des_factures`** (chantier EC-Q3, étape VF1a), appliquée par la session sous la
version `20261018142041` sur l'accord du cabinet (VF1A-Q1), sans confirmation demandée (aucun des mots que le détecteur
retient), AVANT la mise en ligne de la bascule qui la lit ; son fichier a quitté la version PROVISOIRE `20261018120000`
sous laquelle sa réplique l'avait éprouvée, et il porte le texte appliqué, octet pour octet (17 700 caractères, 18 234
octets, saut de ligne final compris, aucun retour chariot) : sa ligne d'historique rend son empreinte,
`4413a7330c46f3bd0216c760519577f5`. 140 fichiers, 140 migrations, empreinte globale `d22b3bc540aea2dfef7db79b108ba889`
des deux côtés, aucune divergence. Le socle est inchangé (78 instructions, `91ae95ec…` — la migration ne touche aucune
table du socle) ; l'inventaire compte 2 088 objets, `6a5c889df10eaa2fb3c8ce47b0eb083f` des deux côtés (2 081 avant elle)
— une colonne, sa clé, un index, un déclencheur et trois fonctions, en plus. `signature.sql` rend en production ce que
l'étape avait relevé sur sa réplique après la migration : les colonnes (851), les contraintes (659), les index (231), les
déclencheurs (56), les fonctions et leurs droits (174) changent ; les policies (157, `58878930…`), la RLS (80,
`9e8ffc97…`) et les droits des tables (80, `c7ec7672…`) gardent l'empreinte d'avant. L'essai
`supabase/essais/exemplairesDesFactures.sql`, rejoué en production sans ses lignes de commentaire (40 417 caractères,
reçus tels quels, `c1d06812…`), rend ses 102 verdicts justes, mutations comprises, et rien n'est resté en base ;
`rls.sql`, rejoué entier sur la réplique avant et après la migration (46 lignes, 0 en faute, 43 mutations sur 43,
sorties identiques), ne l'est pas en production : la migration ne crée ni ne change aucune policy, ce que le contrôle 156
de l'essai vérifie en production (les quatre policies de `pieces`, `95217063…`, celles d'avant).

**Rejoué le 19/10/2026 après `source_de_la_vente` et `encaissements_de_la_vente_facturee`** (chantier EC-Q3, étape VF2),
accordées par le cabinet (VF2-Q1). La première, appliquée par la session sous la version `20261018201312`, sans
confirmation demandée ; la seconde, qui retire deux contraintes et une signature de fonction (aucune donnée), retenue par
le détecteur, puis collée par le cabinet dans l'éditeur SQL sous la version `20261019070229` — dans un texte qui vérifiait
sa propre empreinte et la présence de la première, et posait sa ligne d'historique. Les deux fichiers portent les textes
appliqués, octet pour octet (15 343 et 67 129 caractères, aucun retour chariot) : leurs lignes d'historique rendent
`afd3abea…` et `719aaf05…`. 142 fichiers, 142 migrations, empreinte globale `4dacd12eddaf5676031e86f83c40b274` des deux
côtés, aucune divergence. Le socle est RÉGÉNÉRÉ (80 instructions, `5d53eea28b1dc7dca878423222ed744d` des deux côtés ; 78
avant) : les migrations ajoutent à deux de ses tables, `ecritures_brouillon` et `lignes_bancaires`, trois colonnes, deux
clés, deux index partiels et une contrainte, et en remplacent une ; l'inventaire compte 2 111 objets,
`5cf5d6e54235089da651c868beccc2d2` des deux côtés (2 088 avant elles). `signature.sql` : les colonnes (856), les
contraintes (662), les index (233), les déclencheurs (60), les fonctions et leurs droits (183) changent ; les policies
(157, `58878930…`), la RLS (80, `9e8ffc97…`) et les droits des tables (80, `c7ec7672…`) gardent l'empreinte d'avant.
L'essai `supabase/essais/ventesFacturees.sql`, rejoué en production sans ses lignes de commentaire (59 764 caractères,
reçus tels quels, `1a9d47e6…`), rend ses 164 verdicts justes, mutations comprises, et rien n'est resté en base ;
`rls.sql`, rejoué entier sur une réplique dont les neuf familles égalaient la production (46 lignes, 0 en faute, 43
mutations sur 43), ne l'est pas en production : les migrations ne créent ni ne changent aucune policy.

**Rejoué le 20/10/2026 après `ecritures_de_la_vente_facturee`** (chantier EC-Q3, étape VF4b), accordée par le cabinet.
Retenue par le détecteur (deux corps de fonction suppriment des écritures proposées), collée par le cabinet dans
l'éditeur SQL sous la version `20261020114708` — dans un texte qui vérifiait sa propre empreinte et la présence de la
migration de VF2, et posait sa ligne d'historique ; son fichier a quitté la version PROVISOIRE `20261020120000` sous
laquelle sa réplique l'avait éprouvée, et porte le texte appliqué, octet pour octet (77 820 caractères, aucun retour
chariot) : sa ligne d'historique rend `1543496d09923573d9aa9cc105f94b8b`. 143 fichiers, 143 migrations, empreinte
globale `39103e7c58c2f2a31c4d58685e1b8357` des deux côtés, aucune divergence. Le socle est inchangé (80 instructions,
`5d53eea2…`) : la migration n'ajoute à ses tables qu'un déclencheur d'`ecritures_brouillon`, qu'il ne relève pas.
L'inventaire compte 2 122 objets, `b2666bf360d0922b1c40cdbd6a14a8b1` des deux côtés (2 111 avant elle), après une
correction d'`inventaire.py`, qui comptait les paramètres `out` dans la signature d'une fonction
(`ecriture_attendue_vente_facturee` y recevait /6 quand la base dit /3 : même nombre d'objets, empreintes différentes).
`signature.sql` : les colonnes (857), les contraintes (663), les déclencheurs (61), les fonctions et leurs droits (191)
changent ; les index (233, `8184f0dc…`), les policies (157, `58878930…`), la RLS (80, `9e8ffc97…`) et les droits des
tables (80, `c7ec7672…`) gardent l'empreinte d'avant. Les droits des fonctions diffèrent de ceux de la réplique : les
privilèges par défaut de Supabase donnent en production l'exécution de toute fonction neuve à `service_role`, comme pour
celles de VF2. L'essai `supabase/essais/ecrituresVentesFacturees.sql`, rejoué en production sans ses lignes de
commentaire (59 906 caractères, reçus tels quels, `86060716…`), rend ses 165 verdicts justes, et rien n'est resté en
base ; les quatre essais au jeu de départ en production dont le texte ne porte aucune suppression aussi (`compteBilan`,
`virementPersonnel`, `dotations`, `laBaseLitLePlan`) ; six autres, dont le texte porte une suppression que l'outil
retient, se rejoueront avec le lot qui change leurs fonctions (R1). `rls.sql`, rejoué entier sur la réplique avant et
après la migration (46 lignes, 0 en faute, 43 mutations sur 43), ne l'est pas en production : la migration ne crée ni ne
change aucune policy.

**Rejoué le 21/10/2026 après `lignes_propres_au_mouvement`** (chantier EC-Q3, le lot de R1), accordée par le cabinet.
Retenue par le détecteur (les dix-huit corps de fonction suppriment des écritures, comme avant), collée par le cabinet
dans l'éditeur SQL sous la version `20261021195226` — dans un texte qui vérifiait sa propre empreinte et la présence de
la migration de VF4b, refusait une seconde application et posait sa ligne d'historique ; son fichier a quitté la version
PROVISOIRE `20261021120000` sous laquelle sa réplique l'avait éprouvée, et porte le texte appliqué, octet pour octet (73
306 caractères, aucun retour chariot) : sa ligne d'historique rend `76c37897015d13b8e23601a9ae8d6b27`. 144 fichiers, 144
migrations, empreinte globale `e1ece0554f7eaf75e1e80732587a439c` des deux côtés, aucune divergence. Le socle (80
instructions, `5d53eea2…`) et l'inventaire (2 122 objets, `b2666bf3…`) sont inchangés : la migration ne crée ni ne
retire aucun objet, elle redéfinit dix-huit fonctions, dont les corps en production sont ceux du fichier, empreinte par
empreinte. L'essai `supabase/essais/ecrituresVentesFacturees.sql`, rejoué en production sans ses lignes de commentaire
(77 712 caractères, reçus tels quels, `ed45d71d…`), rend ses 176 verdicts justes, et rien n'est resté en base. Les
cinquante-six essais, dont les six qui portent une suppression que l'outil retient (`affectation`,
`cotisationRapprochee`, `echeanceEmprunt`, `reglementGroupe`, `reglesAffectation`, `ventilation`), ont été rejoués sur
une réplique dont les neuf familles égalaient la production, avant et après la migration : leurs verdicts sont
identiques, hors des douze que le lot change. `rls.sql`, rejoué entier sur la réplique (46 lignes, 0 en faute, 43
mutations sur 43), ne l'est pas en production : la migration ne crée ni ne change aucune policy.

**Rejoué le 22/10/2026 après `contre_passation_banque`** (chantier EC-Q3, le correctif de la contre-passation), accordée
par le cabinet. Appliquée par `apply_migration`, sans confirmation demandée (le texte ne porte ni suppression, ni
`drop`, ni `truncate`), sous la version `20261022185455` ; son fichier a quitté la version PROVISOIRE `20261022180000`
sous laquelle sa réplique l'avait éprouvée, et porte le texte appliqué, octet pour octet (13 564 caractères, aucun
retour chariot) : sa ligne d'historique rend `21e792e4be469bbb9e89a8299dacf78e`. 145 fichiers, 145 migrations, empreinte
globale `9783a976c53560c02069b631b7ca0399` des deux côtés, aucune divergence. Le socle (80 instructions, `5d53eea2…`) et
l'inventaire (2 122 objets, `b2666bf3…`) sont inchangés : la migration ne crée ni ne retire aucun objet, elle redéfinit
`annuler_encaissement`, dont le corps en production est celui du fichier (`280da760…`), son commentaire et ses droits
gardés. `signature.sql` : seule la famille « fonctions » change (191, `d44b4741…` puis `5a51f41d…`), et les neuf
familles égalent celles de la réplique après la migration. L'essai `supabase/essais/ventesFacturees.sql`, rejoué en
production sans ses lignes de commentaire (61 813 caractères, reçus tels quels, `7f0248f2…`), rend ses 172 verdicts
justes, et rien n'est resté en base. `rls.sql`, rejoué entier sur la réplique (46 lignes, 0 en faute, 43 mutations sur
43), ne l'est pas en production : la migration ne crée ni ne change aucune policy.

**Rejoué le 23/10/2026 après `impaye_non_declare`** (chantier EC-Q3, étape VF5d2), accordée par le cabinet. Appliquée
par `apply_migration`, sans confirmation demandée (le texte ne porte ni suppression, ni `drop`, ni `truncate`), sous la
version `20261023063657` ; son fichier a quitté la version PROVISOIRE `20261022230000` sous laquelle sa réplique l'avait
éprouvée, et porte le texte appliqué, octet pour octet (13 951 caractères, aucun retour chariot) : sa ligne d'historique
rend `2c1daa4697c23527f2d71c489f4e56f2`. 146 fichiers, 146 migrations, empreinte globale
`c096ac1d6e2bcf64d3bf5ee3d438ec37` des deux côtés, aucune divergence. Le socle (80 instructions, `5d53eea2…`) et
l'inventaire (2 122 objets, `b2666bf3…`) sont inchangés : la migration ne crée ni ne retire aucun objet, elle redéfinit
`annuler_encaissement`, dont le corps en production est celui du fichier (`93cd70fc…`), son commentaire réécrit
(`7721f9f6…`) et ses droits gardés. `signature.sql` : seule la famille « fonctions » change (191, `5a51f41d…` puis
`d24edf75…`), et les neuf familles égalent celles de la réplique après la migration. L'essai
`supabase/essais/ventesFacturees.sql`, rejoué en production sans ses lignes de commentaire (66 060 caractères, reçus
tels quels, `7587424e…`), rend ses 187 verdicts justes, et rien n'est resté en base ; les trois autres essais du lot ne
le sont que sur la réplique, les fonctions qu'ils éprouvent n'ayant pas changé, hors celle-ci. `rls.sql`, rejoué entier
sur la réplique (46 lignes, 0 en faute, 43 mutations sur 43), ne l'est pas en production : la migration ne crée ni ne
change aucune policy.

**Rejoué le 24/10/2026 après `virement_mixte` et `jumelle_inversee`** (chantier EC-Q3, étapes VF5h et VF6b), accordées
par le cabinet. Appliquées par `apply_migration`, sans confirmation demandée, sous les versions `20261024052038` et
`20261024052424` ; leurs fichiers ont quitté les versions PROVISOIRES `20261023200000` et `20261023210000` sous lesquelles
leurs répliques les avaient éprouvées, et portent les textes appliqués, octet pour octet (aucun retour chariot) : leurs
lignes d'historique rendent `ebbcd8407ecc3338ca625afc397afb8c` et `5a1394d473db7a60cb551b64f451438a`. 148 fichiers, 148
migrations, empreinte globale `19c0e53c5514e71e7af8c80874106e79` des deux côtés, aucune divergence. Le socle est inchangé
(80 instructions, `5d53eea2…`) ; l'inventaire compte 2 155 objets (`855735eaca8d59e2464550dcfd598e7b`, des deux côtés,
2 122 avant). `signature.sql` : les neuf familles égalent celles de la réplique de VF6b munie des deux migrations, où
tous les essais ont été joués entiers ; en production, un contrôle ciblé de la table neuve, aucun essai entier
(HISTORIQUE.md, « LE VIREMENT MIXTE ET LA JUMELLE INVERSÉE EN PRODUCTION »).

**Rejoué le 26/10/2026 après `registre_virement_mixte`, `frontiere_des_encaissements`,
`validation_des_ventes_facturees`, `gel_des_designations` et `reglage_des_ventes`** (chantier EC-Q3, étapes VF5h2, VF7a,
VF7b, VF7e et VF8a), accordées par le cabinet. Appliquées dans cet ordre par `apply_migration`, sans confirmation
demandée, sous les versions `20261026000145`, `20261026000313`, `20261026000623`, `20261026000808` et `20261026000858` ;
leurs fichiers ont quitté les versions PROVISOIRES `20261024120000`, `20261025120000`, `20261025180000`,
`20261026090000` et `20261026120000` sous lesquelles leurs répliques les avaient éprouvées, et portent les textes
appliqués, octet pour octet (aucun retour chariot) : leurs lignes d'historique rendent
`65c118eb783c46f2230e4543c1ca0c17`, `387889c034a62b5a63ce62102d295ab0`, `b5c3dad446ff6cbbb96ef6045ed816ce`,
`3a1cf57ac45fc9829a116126730c6502` et `783cf05937bb40c1e0478471c94977eb`. 153 fichiers, 153 migrations, empreinte
globale `e63d2d172770ace9fcdcbcfcb52a8820` des deux côtés, aucune divergence. Le socle est inchangé (80 instructions,
`5d53eea2…`) ; l'inventaire compte 2 163 objets (`b20a312cfd61acc4cebeeb7737e05325`, des deux côtés, 2 155 avant) — une
fonction et deux déclencheurs de VF7a, deux fonctions de VF7b, deux de VF7e, une colonne de VF8a. `signature.sql` : les
neuf familles égalent celles de la réplique de VF8a munie des cinq migrations, où tous les essais ont été joués entiers
— colonnes 866 (`23b2bc60…`), déclencheurs 69 (`aa7a762c…`), fonctions 202 (`0837e89d…`) et leurs droits 202
(`f61b1cd0…`), les cinq autres familles inchangées ; en production, aucun essai entier : aucune des cinq ne crée ni ne
change de policy ni de droit d'une table (HISTORIQUE.md, « LES CINQ MIGRATIONS DE VF5H2, VF7 ET VF8A EN PRODUCTION »).

**Rejoué le 26/10/2026 après `insertion_des_encaissements`** (chantier EC-Q3, VF5H2-Q1 et VF5H2Q1-Q1), appliquée par
`apply_migration` sous la version `20261026150044`, sur l'accord du cabinet, sans confirmation demandée ; son fichier a
quitté la version provisoire `20261027120000` pour celle-ci, texte inchangé — sa ligne d'historique rend
`2bd728f7dccc41c7ddae9c08e087e17f`, celle du fichier éprouvé. 154 fichiers, 154 migrations, empreinte globale
`9549d833111e4ef18949ba48f7061e66` des deux côtés. Le socle (80 instructions, `5d53eea2…`) et l'inventaire (2 163
objets, `b20a312c…`) sont inchangés, des deux côtés : la migration remplace le corps d'une garde sous son nom.
`signature.sql` : seule la famille « fonctions » change (202, `0837e89d…` puis `d9a632284f551bdf9adb2a93edf19f58`), la
valeur de la réplique de l'étape, où tous les essais ont été joués entiers (HISTORIQUE.md, « L'INSERTION DIRECTE D'UN
ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS », « LA MIGRATION DE VF5H2-Q1 EN PRODUCTION »).

**Rejoué le 27/10/2026 après `index_des_avoirs`, `simulation_des_ventes_facturees` et
`contre_passation_sur_mouvement_fige`** (chantier EC-Q3, VF8E-Q1, VF8e, VF5H2Q1-Q2 et VF5H2Q1Q2-Q1), accordées par le
cabinet le même jour. Appliquées dans cet ordre par `apply_migration`, sans confirmation demandée, sous les versions
`20261027055007`, `20261027055129` et `20261027055337` ; leurs fichiers ont quitté les versions PROVISOIRES
`20261027125000`, `20261027130000` et `20261027140000`, texte inchangé — leurs lignes d'historique rendent
`512638ba6449edbbc89db08e7405296b`, `af60959ca9b13192e43ad588d47b9372` et `98cf7f7ce93f87746af9a188a7dd5b43`, celles des
fichiers éprouvés. 157 fichiers, 157 migrations, empreinte globale `2efe95460fac2c1ce0831142a7509c2d` des deux côtés
(155 et `a167b589…` après l'index, 156 et `603970bc…` après VF8e). Le socle est inchangé (80 instructions,
`5d53eea2…`) ; l'inventaire compte 2 165 objets (`2fd670d3adffb76e3e91ed6887d55875`, des deux côtés, 2 163 avant) —
l'index et la fonction de VF8e ; la garde des encaissements change de corps sous son nom. `signature.sql`, migration par
migration, les valeurs des répliques de l'étape : après l'index, la seule famille « index » (237 `08ef14df…` puis 238
`b9aae28f2e5278de99fc4e617687a011`) ; après VF8e, « fonctions » (202 `d9a63228…` puis 203
`af77709d031abfe1f1b12222eba56e2b`) et « droits des fonctions » (202 `f61b1cd0…` puis 203
`9a52af9e70d503d0f49955c58d164cf7`) ; après la garde, la seule famille « fonctions » (203,
`68fb1b62ba09ebf84c0e774503170649`) ; les six autres familles inchangées. En production, l'essai de la simulation
(`simulationDesVentesFacturees.sql`, sans ses lignes de commentaire) : ses 29 contrôles justes, rien n'est resté ;
`rls.sql` n'y est pas rejoué entier — aucune des trois ne crée ni ne change de policy ni de droit d'une table, et
l'essai rejoue en production, profil par profil, ce que son bloc SI juge (HISTORIQUE.md, « LES TROIS MIGRATIONS DE
VF8E-Q1, VF8E ET VF5H2Q1-Q2 EN PRODUCTION »).

**Rejoué le 27/10/2026 après `equipe_par_son_role` et `ventes_sur_dossier_bascule`** (23Q2Q2-Q3, et le chantier EC-Q3,
étape VF8f), accordées par le cabinet le même jour. Appliquées dans cet ordre par `apply_migration`, sans confirmation
demandée, sous les versions `20261027163235` et `20261027163348` ; leurs fichiers ont quitté les versions PROVISOIRES
`20261027150000` et `20261027160000`, texte inchangé — leurs lignes d'historique rendent
`59c621d0f9f18cc1ce6fd51fb0d52673` et `2bd30520d0a476b5dc398504f0e5e8f3`, celles des fichiers éprouvés. 159 fichiers,
159 migrations, empreinte globale `b70ba907b6a1d1c1d5add7be7580ec20` des deux côtés (158 et `263ea84a…` après la
première). Le socle est inchangé (80 instructions, `5d53eea2…`) ; l'inventaire compte 2 167 objets
(`bb1ddbf6fce1bf2b5e0a0a4593c143c7`, des deux côtés, 2 165 avant) — la garde et son déclencheur ; `equipe_par_son_role`
n'y change rien. `signature.sql`, migration par migration, les valeurs des répliques de l'étape : après
`equipe_par_son_role`, la seule famille « droits_tables » (81, `79e266f1…` puis `c58e26d3cf2f938e22b5f9fc7cd45b8b`) ;
après `ventes_sur_dossier_bascule`, « déclencheurs » (69 `aa7a762c…` puis 70 `31f83f17445c6e1c5d04f6d92dafdde5`),
« fonctions » (203 `68fb1b62…` puis 204 `9dbbaf011e085b810dd069181df59a50`) et « droits des fonctions » (203 `9a52af9e…`
puis 204 `a2b5e8ad9d4bc00d03e94dadf6d280d1`) ; les cinq autres familles inchangées. En production, le texte reçu vérifié
par son empreinte : `droitsAcces.sql` entier, sans ses lignes de commentaire (53 876 caractères, `2f8b8661…`), ses 65
lignes justes, rien n'est resté ; les blocs EQ et VS de `rls.sql`, sans le contrôle EQ3 ni la mutation M-EQ2 (une
suppression et un retrait de droit, que l'outil retient), 0 en faute, 6 mutations sur 6 (HISTORIQUE.md, « LES DEUX
MIGRATIONS DE 23Q2Q2-Q3 ET VF8F EN PRODUCTION »).

**Appliqué le 29/10/2026 : `mentions_figees`, puis `iban_hors_des_parametres`** (espace client, étape A7a, ligne 51.5 :
la facture fige ses mentions ; A7-Q1 à A7-Q3, puis A7Q-Q1). La première, COLLÉE par le cabinet — le corps
d'`enregistrer_facture` supprime les lignes qu'il remplace —, porte la version de l'heure du collage, `20261029214359`,
et sa ligne d'historique rend `3951edd8840aa8e1a8f3b613bd0045a3` ; la seconde, appliquée ensuite par l'outil,
`20261029214732`, rend `582096c994fca10adc592f636aaeea77`. Leurs fichiers, préparés sous les versions provisoires
`20261028120000` et `20261028130000`, sont renommés à leur version, texte inchangé. Les trois contrôles, relus en
production le jour même : 161 fichiers, 161 migrations, `ebc55ced3b67e87916dd5bf155f31ebd` des deux côtés ; le socle
inchangé (80 instructions, `5d53eea2…`) ; l'inventaire, 2 210 objets, `9c98c43514b87cafedad6d2324cee799` des deux côtés
(2 167 avant) — vingt-neuf colonnes, onze contraintes, trois fonctions ; la contrainte remplacée, `enregistrer_facture`
et `enregistrer_parametres_facturation` changent sous leur nom. `signature.sql`, en production : « colonnes » 895
`05cda372…`, « contraintes » 681 `5ade7583…`, « fonctions » 207 `2a91cbe0…`, « droits des fonctions » 207 `6438f4dc…`,
les cinq autres inchangées — les valeurs de la réplique de l'étape munie des deux, où leurs essais sont passés entiers
(HISTORIQUE.md, « LES DEUX MIGRATIONS D'A7 EN PRODUCTION »).

**Appliqué le 30/10/2026 : `caisse`, puis `caisse_retrait_et_versement`** (ligne 26.6, étapes C1 et C1b ; HISTORIQUE.md,
« LA CAISSE EN PRODUCTION : LES DEUX MIGRATIONS ET LE DRAPEAU LEVÉ »). Sur l'accord du cabinet, `caisse` par l'outil
(version `20261030073812`, sa ligne d'historique `20bbd94ff38cf78b297896c697ffdaea`), puis `caisse_retrait_et_versement`,
collée par le cabinet (version `20261030123801`, `6104e62c7ed5ee81ce4f1c81c40eb5cd`) ; leurs fichiers quittent
`supabase/preparees/` pour entrer ici sous ces versions, textes inchangés, et le socle se régénère (la colonne
d'`ecritures_brouillon`, sa clé, sa contrainte et son index). Les trois contrôles, égaux des deux côtés : 163 fichiers et
163 migrations, `4f380da572afcd602eb480203ac5a898` ; le socle, 81 instructions, `5d636a96f2a2fb373d668da5c26f6554` ;
l'inventaire, 2 284 objets, `efbc0207c63081b484ebfc07eb7a538c`. `signature.sql` en production, avant (les neuf familles
d'après A7), après la première (« fonctions » et « droits des fonctions » 215, `866f0ee9…` et `94bc8f4a…`, les sept
autres déjà à leurs valeurs finales) et après la seconde : « colonnes » 911 `13d1263c3f4d08381411d33ccb2e3e72`,
« contraintes » 710 `ce4cd645805f61594330230eb9a69fa1`, « déclencheurs » 82 `86c12843…`, « fonctions » 217
`7372ffd259a85ef62b5a2bbb1ab2c780`, « droits des fonctions » 217 `8ea236a6697c3a1e57a1ec2a666dfa4b`, « index » 244
`9704c175…`, « policies » 161 `6e6e0706…`, « RLS » 82 `5fb5dc41…`, « droits des tables » 82 `36d97923…` — chaque fois
égales à celles d'une réplique de la production du jour (161 migrations, A7 comprise) munie des mêmes migrations, où
les essais de la caisse sont passés entiers.

**Préparé le 29/10/2026 (appliqué le 30/10/2026, ci-dessus) : `caisse`** (ligne 26.6, étape C1 : la caisse d'un dossier
BNC, MVP-D2).
Son fichier vit HORS de l'export, dans `supabase/preparees/`, sous une version PROVISOIRE, `20261029120000`, après
celles d'A7 : il crée une table, que `sauvegardeTables.test.ts` et `sauvegardeRelations.test.ts` exigeraient au plan de
sauvegarde du jour, et l'étape C2 l'y met, derrière son drapeau. Elle s'applique par l'outil — ni table, ni colonne, ni
donnée retirée ; le mot n'y paraît que dans les clés, les événements des déclencheurs et `tg_op` —, avec C2, jamais
avant. Le fichier entre alors ici sous la version que porte sa ligne d'historique, texte inchangé, et cette ligne doit
rendre `20bbd94ff38cf78b297896c697ffdaea` ; le socle se RÉGÉNÈRE (la colonne d'`ecritures_brouillon`, sa clé, sa
contrainte et son index) : 81 instructions, `5d636a96f2a2fb373d668da5c26f6554` des deux côtés, 80 avant. `socle.sql`
écarte depuis ce jour les déclencheurs de contrainte (contype « t »), que `pg_get_constraintdef` rend « TRIGGER … » et
qu'aucun `create table` n'accepte — la migration en pose trois sur `lignes_bancaires` — ; la production n'en a aucun sur
une table du socle, et rend toujours 80, `5d53eea2…`. Tant qu'elle n'est pas appliquée, l'export ne la porte pas, et ses
trois contrôles sont ceux de la production. Sur la réplique de l'étape (la production à 159 migrations, son historique
et ses neuf familles égaux à ceux de la production, relus le 29/10/2026), munie d'elle sous sa version provisoire, et
sur un miroir de l'export qui la porte avec le socle régénéré : 160 fichiers, 160 migrations,
`511623c998535817acf8933731c4fdb3` des deux côtés ; avec les deux d'A7, dans les trois ordres, 162,
`24972780cdd2e299994c9d1823cf65d1` (`5756720a…` avant A7Q-Q1, qui change le texte de `mentions_figees`). L'inventaire
compte 2 239 objets (`5593b39b1dc6c83adb9af83410259cbc`, des deux côtés ; 2 167 avant), 2 282 avec A7
(`fad54caa6f05492dfaacec2759190c44`) — seize colonnes, vingt-neuf contraintes (dont
les dix déclencheurs de contrainte, que le catalogue range aussi parmi elles), quatre index, douze déclencheurs, deux
policies, huit fonctions et la RLS de la table. `signature.sql` : les neuf familles changent — « colonnes » (866
`23b2bc60…` puis 882 `63eeb954a7edf0fdd2fb6592102c7a8d`), « contraintes » (670 `d63ab39f…` puis 699
`0ff69a21901c397707f773dfb3bc7708`), « déclencheurs » (70 `31f83f17…` puis 82 `86c12843b3544c3dae5e1e1767c7ba7e`),
« fonctions » (204 `9dbbaf01…` puis 212 `ebcdaf5dcba1f8a55d080755f86e5243`), « droits des fonctions » (204 `a2b5e8ad…`
puis 212 `ddcdda6933f81c9e51ec32b5d0b9b26a`), « index » (238 `b9aae28f…` puis 244 `9704c1759b5115786dc9fa0a1fb7d2ce`),
« policies » (159 `c6aae852…` puis 161 `6e6e070636b1770aaf5b955967753801`), « RLS » (81 `6450be96…` puis 82
`5fb5dc41656d97b950a8b000736361e0`) et « droits des tables » (81 `c58e26d3…` puis 82 `36d9792358e1c399ac1fccf6d7bcc642`)
— et reviennent à la production, historique compris, après son retour arrière ; les trois ordres avec A7 rendent une
même signature (HISTORIQUE.md, « LA CAISSE, EN BASE : LA MIGRATION `CAISSE` (C1, LIGNE 26.6) »).

**Préparé le 29/10/2026 (collé le 30/10/2026, ci-dessus) : `caisse_retrait_et_versement`** (ligne 26.6, étape C1b : le
retrait, le remplacement et le versement d'espèces). Son fichier vit HORS de l'export, dans `supabase/preparees/`, sous une version
PROVISOIRE, `20261029130000`, après celle de `caisse`, qu'il exige (sa garde de tête refuse une base sans elle). Il se
COLLE — le corps de ses deux fonctions retire les lignes du brouillon d'une opération retirée — : le texte à coller
vérifie son empreinte, refuse une seconde application et une base dont l'historique ne porte pas `caisse`, et pose la
ligne d'historique sous la version de l'heure du collage ; le fichier entre alors ici RENOMMÉ à cette version, texte
inchangé, avec `caisse` et l'étape C2, et sa ligne doit rendre `6104e62c7ed5ee81ce4f1c81c40eb5cd`, fins de ligne
ramenées à `\n`. Tant qu'il n'est pas collé, l'export ne le porte pas, et ses trois contrôles sont ceux de la
production. Sur la réplique de l'étape (la production à 159 migrations, son historique et ses neuf familles égaux à ceux
de la production, relus le 29/10/2026), munie de `caisse` puis de lui par l'outil sous sa version provisoire, et sur un
miroir de l'export qui porte les deux avec le socle régénéré de `caisse` : 161 fichiers, 161 migrations,
`467b06632f13f2f8b6934a3e82ea8685` des deux côtés ; collé (version `20261029192809`), le fichier renommé à sa version,
`e65694ca1227b8790131ea2d4715d8aa` des deux côtés ; avec les deux d'A7, dans les trois ordres, 163,
`ea2050ef82470daa3322fdbc0ef0ded4`. Le socle est celui de `caisse` (81 instructions, `5d636a96…`) : il ne touche aucune
table. L'inventaire compte 2 241 objets (`bd1bb32aab9a61a2c1cce99fd40a9ffe`, des deux côtés ; 2 239 avec `caisse`
seule), 2 284 avec A7 (`efbc0207c63081b484ebfc07eb7a538c`) — ses deux fonctions ; `refus_compte_de_bilan` et
`ecrire_mouvement_compte_bilan` changent sous leur nom. `signature.sql` : deux familles changent, « fonctions » (212
`ebcdaf5d…` puis 214 `35f11dc2312bae3b36591ea1c7f9ed11`) et « droits des fonctions » (212 `ddcdda69…` puis 214
`dba5babf0c9b5aac470f06fae25e7ded`), les sept autres inchangées ; collé ou appliqué par l'outil, la même signature ;
elles reviennent à celles d'après `caisse`, historique compris, après son retour arrière ; les trois ordres avec A7
rendent une même signature (HISTORIQUE.md, « LA CAISSE, EN BASE : LE RETRAIT, LE REMPLACEMENT ET LE VERSEMENT D'ESPÈCES
(C1B, LIGNE 26.6) »).

**Préparé le 30/10/2026, PAS ENCORE APPLIQUÉ : `especes_sans_mouvement`** (ligne 26.6, étape C6 : le resserrement de la
caisse — un encaissement en espèces ne cite aucun crédit du relevé). Son fichier vit HORS de l'export, dans
`supabase/preparees/`, sous une version PROVISOIRE, `20261030180000`, après celles de la caisse (20 736 caractères,
21 116 octets, 291 lignes, `40e539ff4eb5da4062fd70c89a7e503a`, ni barre oblique inverse ni retour chariot). Il
s'applique PAR L'OUTIL : ni `drop`, ni `delete from`, ni `truncate`, ni `grant` ni `revoke` — le mot de la suppression
n'y paraît que dans `tg_op = 'DELETE'`, comme dans la garde d'hier, que l'outil a passée le 27/10/2026 sans demander de
confirmation. Sa garde de tête exige le corps de la garde des encaissements que `contre_passation_sur_mouvement_fige` a
posé (`16af585818378356e7b4e58521dbe665`, la production), sinon elle refuse en le disant — une seconde application aussi ;
puis `create or replace function public.garder_encaissement_facture()` (OID, propriétaire, droits et déclencheur gardés),
sa définition d'hier au caractère près, une règle INSÉRÉE après celle qui veut un crédit pour un encaissement et un débit
pour une contre-passation : un encaissement de moyen « espèces » qui cite un crédit (un mouvement de montant positif) se
refuse en 23514, « Un encaissement en espèces ne cite aucun crédit du relevé : il s'enregistre sans mouvement, et le dépôt
des espèces en banque se classe à part. » — à l'insertion comme au rattachement, de toute facture, le
super-administrateur compris ; passent sa contre-passation (elle cite un débit) et la restauration (une ligne INSÉRÉE par
le super-administrateur sous son instant de création d'avant la transaction, la porte de `garder_la_caisse`). Corps
neuf : 14 813 caractères, `31fdfcc86b476669612b459555e94f13`. Le fichier entre ici sous la version que portera sa ligne
d'historique, texte inchangé, et cette ligne doit rendre `40e539ff…`. Son RETOUR ARRIÈRE
(`supabase/preparees/retour/20261030180100_retour_especes_sans_mouvement.sql`, 15 603 caractères,
`76a479a1f7bb39efe997b27b1440f2a8`) : sa garde de tête exige `31fdfcc8…`, puis la garde d'hier au caractère près, par
`create or replace` — rien ne s'y retire ; appliqué par l'outil, il pose sa propre ligne d'historique à la suite (retirer
celle de la migration serait une suppression, à accorder). Aucune donnée ne se perd, dans un sens ni dans l'autre. Tant
qu'elle n'est pas appliquée, l'export ne la porte pas, et ses trois contrôles sont ceux de la production (163 fichiers,
`4f380da5…` ; socle 81, `5d636a96…` ; inventaire 2 284, `efbc0207…`). Sur la réplique de l'étape (la production du
jour, 163 migrations, ses neuf familles égales à celles de la production, relues le 30/10/2026), munie d'elle sous sa
version provisoire, et sur un miroir de l'export qui la porte : 164 fichiers et 164 migrations, égaux nom par nom
(`b22c6cc8eb9209007eac89457a681c37` pour le miroir, un agrégat que la version réelle changera) ; le socle inchangé (81
instructions, `5d636a96…`) ; l'inventaire inchangé (2 284 objets, `efbc0207…`) — la garde change sous son nom.
`signature.sql` : la seule famille « fonctions » change (217, `7372ffd2…` puis `3800368f333f960c6b366acc8a666531`), les
huit autres inchangées, « droits des fonctions » et « déclencheurs » compris ; elles reviennent toutes à la production
après le retour arrière, qu'une seconde application refuse comme la migration (HISTORIQUE.md, « LA CAISSE : LE
RESSERREMENT (C6, LIGNE 26.6) (PRÉPARÉE, PAS APPLIQUÉE) »).

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

**Rejoués le 11/10/2026 après `revue_analytique`** (ligne 41, étape R5), sur la réplique de l'étape, son fichier réuni :
le socle est inchangé (78 instructions, `91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés — la migration ne touche aucune
table du socle) ; l'inventaire compte 1 712 objets, empreinte `326c3b413ea6b27f0dabd931a96685fb` des deux côtés (1 650,
`a2c52236…`, sans elle). `revue_analytique` en ajoute 62 : vingt et une colonnes, vingt et une contraintes, quatre
index, deux déclencheurs, quatre policies, huit fonctions et la RLS de ses deux tables. À rejouer en production après
l'application.

**Rejoués le 11/10/2026 sur la réplique de l'étape, pour `regimes_ereporting_et_pieces_ecartees`** (ligne 28.5, étape
e5a, préparée, pas encore appliquée) : le socle est inchangé (78 instructions, `91ae95ec73c3b7bdc9f4307b5443144f` des
deux côtés — la migration ne touche aucune table du socle, et le déclencheur qu'elle pose sur `pieces` vit dans son
fichier) ; l'inventaire compte 1 711 objets, empreinte `5fffd292bf513892e264ba674d261f73` des deux
côtés (la réplique sans la migration : 1 650, `a2c52236…`, la production d'aujourd'hui). La migration en ajoute 61 :
vingt-deux colonnes, dix-sept contraintes, cinq index, trois déclencheurs, quatre policies, huit fonctions et la RLS de
ses deux tables. Après l'application, les deux contrôles se rejouent contre la production.

**Rejoués le 11/10/2026 en production, les deux migrations appliquées** : le socle est inchangé (78 instructions,
`91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés) ; l'inventaire compte 1 773 objets, empreinte
`4b6f605bfd59c002202749f83e4450ed` des deux côtés — les 1 650 de P2, plus les 62 de `revue_analytique` et les 61 de
`regimes_ereporting_et_pieces_ecartees`.

**Rejoués le 11/10/2026 pour `declarations_ereporting`** (ligne 28.5, étape e5b1), sur la réplique de l'étape puis
contre la production après l'application : le socle est inchangé (78 instructions,
`91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés — la
migration ne touche aucune table du socle, et le déclencheur qu'elle pose sur `pieces` vit dans son fichier) ;
l'inventaire compte 1 834 objets, empreinte `417e33d59ae5172b0c4b6ab2f0e5a72a` des deux côtés (la réplique sans la
migration : 1 773, `4b6f605b…`, la production d'aujourd'hui). La migration en ajoute 61 : vingt et une colonnes, vingt
et une contraintes, cinq index, trois déclencheurs, quatre policies, cinq fonctions et la RLS de ses deux tables. La
période d'e1 en SQL (`periode_ereporting`) rend une table et non des paramètres de sortie : l'inventaire, qui compte les
arguments d'une fonction dans sa parenthèse, en aurait compté quatre là où le catalogue en compte deux. En production,
après l'application : les mêmes valeurs, socle 78 `91ae95ec…` et inventaire 1 834 `417e33d5…` des deux côtés.

**Rejoués le 11/10/2026 contre la production après `la_base_lit_le_plan_1` à `_6`** (ligne 43, étape PC2) : le socle est
inchangé (78 instructions, `91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés) et l'inventaire aussi (1 834 objets,
`417e33d59ae5172b0c4b6ab2f0e5a72a` des deux côtés). Les six migrations ne créent rien : elles remplacent quatorze corps de
fonction, sous les mêmes noms et les mêmes arguments, et sept commentaires de fonction (qu'aucun des trois contrôles ne
lit) — seule la famille « fonctions » de `signature.sql` change.

**Rejoués le 11/10/2026 sur la réplique de l'étape, pour `dossier_permanent`** (ligne 41, étape R7), les six fichiers de PC2 réunis à l'export : le socle est inchangé (78 instructions,
`91ae95ec73c3b7bdc9f4307b5443144f` des deux côtés — la migration ne touche aucune table du socle ; la fonction qu'elle
remplace, `garder_source_citee`, et les déclencheurs de l'étape R1 sur `pieces` et `documents_divers` vivent dans leur
fichier) ; l'inventaire compte 1 875 objets, empreinte `ae3d8044360b924ddd75867c967236e6` des deux côtés (la réplique
sans la migration : 1 834, `417e33d5…`, la production d'aujourd'hui). La migration en ajoute 41 : seize colonnes, quinze
contraintes, trois index, un déclencheur, deux policies, trois fonctions et la RLS de sa table ; `garder_source_citee`,
remplacée sous le même nom, n'en ajoute aucun. L'inventaire de la base compte les policies du stockage : sur une
réplique qui n'en a pas le talon, il rend 8 objets de moins des deux côtés de la migration. Après l'application, les
deux contrôles se rejouent contre la production. En production, après
l'application (12/10/2026, version `20261012070920`) : les mêmes valeurs, socle 78 `91ae95ec…` et inventaire 1 875
`ae3d8044…` des deux côtés.

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
