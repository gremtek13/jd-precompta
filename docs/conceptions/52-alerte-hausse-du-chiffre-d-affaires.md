# 52 — L'alerte de hausse (et de baisse) du chiffre d'affaires d'un dossier

Conçue le 15/11/2026, au MVP (un premier dossier BNC réel, un praticien en trésorerie) ; reprise le 16/11/2026 sur les réponses
du cabinet (§ 0). La demande du cabinet, dictée le 15/11/2026 : « une alerte, peut-être trimestrielle, sur quand le chiffre
d'affaires augmente. Après le pourcentage, c'est l'expert-comptable qui le décide sur chaque dossier […] ça met une alerte sur le
dossier pour que le comptable qui s'en occupe, il voit avec le client ». Sa précision du même jour : l'alerte ne fait que
SIGNALER ; ce que l'expert-comptable en dit au client (« peut-être de réinvestir ou quoi que ce soit »), il le décide. Les mots
de l'alerte restent donc neutres : le constat, les chiffres comparés, les seuils du dossier — jamais un conseil, à la hausse
comme à la baisse.

Le code : `src/lib/hausseDuChiffreDAffaires.ts` (pur), `src/lib/hausseDuChiffreDAffairesLecture.ts` (la lecture), la migration
préparée `supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql` et son retour, les essais
`supabase/essais/hausseDuChiffreDAffaires.sql` et `hausseDuChiffreDAffairesSuppression.sql`, trois écrans derrière
`HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE`, baissé. Les noms — le drapeau, les deux tables, les deux fonctions, la migration, les
fichiers — gardent le mot « hausse » de la demande : la baisse s'y est ajoutée sans les renommer ; les mots de l'écran, eux,
disent les deux sens.

## 0. Les réponses du cabinet (16/11/2026)

| Question | Réponse | Ce qu'elle a changé |
|---|---|---|
| CA-Q1 — ce qui se compare à quoi | (A) le trimestre OU le cumul atteint le seuil — la recommandation | rien : c'était ainsi |
| CA-Q2 — une alerte à la baisse aussi ? | (C) oui, avec un seuil de baisse réglé à part — contre la recommandation (A) | un seuil de baisse en base, une colonne de la ligne du dossier ; le jugement, les mots et la carte dans les deux sens (§ 1, 3, 5) |
| CA-Q3 — le rythme | (C) trimestriel, et en plus douze mois glissants — contre la recommandation (A) | une troisième comparaison, les douze mois qui finissent avec le trimestre (§ 1) ; rien en base |
| CA-Q4 — qui voit et règle | (A) tout le cabinet du dossier : le chef et les membres affectés — la recommandation | rien : c'était ainsi (§ 3, 4) |
| CA-Q5 — le chiffre comparé | (A) les recettes encaissées, comme l'onglet Estimation — la recommandation | rien : c'était ainsi (§ 2) |
| CA-migration | (A) oui, après CA-Q2 et CA-Q4 | la migration, reprise sur CA-Q2, s'applique par l'outil (§ 7) |

## 1. Ce qui se compare à quoi

**Retenu.** À la fin de chaque trimestre civil, trois comparaisons, chacune contre la même période un an plus tôt :

- les recettes encaissées du **trimestre écoulé** contre celles du même trimestre de l'année d'avant ;
- le **cumul depuis le 1er janvier** jusqu'à la fin de ce trimestre contre le cumul de l'année d'avant à la même date (au
  1er trimestre, le cumul est le trimestre : il ne se compte pas) ;
- les **douze mois clos qui finissent avec le trimestre** contre les douze mois d'avant (CA-Q3 (C)) : au 3e trimestre 2026,
  d'octobre 2025 à septembre 2026 contre d'octobre 2024 à septembre 2025. La fenêtre glisse d'un trimestre à chaque
  trimestre ; au 4e, elle est l'année civile, que le cumul compare déjà : elle ne se compte pas. Elle donne, à chaque
  trimestre, une vue sur une année entière qui ne repart pas de zéro en janvier — ce que le cumul ne sait pas faire au 1er et
  au 2e trimestre.

Deux seuils, chacun nul s'il n'y a pas d'alerte dans ce sens (CA-Q2 (C)) : l'alerte se dit quand **l'une des comparaisons**
(CA-Q1 (A)) atteint le seuil de **hausse** (≥) ou le seuil de **baisse** (≥), jugés exactement en centimes entiers :
hausse (N − P) × 100 ≥ seuil × P, baisse (P − N) × 100 ≥ seuil × P, P strictement positif. Une comparaison ne monte et ne
baisse pas à la fois ; deux comparaisons peuvent aller en sens contraires (un trimestre en hausse au bout d'une année en
baisse) : l'alerte se dit alors « Variation du chiffre d'affaires », ses phrases disant chaque sens. La variation montrée
l'est au dixième de point, signée ; un arrondi d'affichage ne décide rien (19,96 % se montre 20,0 % et n'atteint pas 20 %, à
la hausse comme à la baisse).

**Écartés.** Le trimestre contre le trimestre précédent : la saisonnalité d'un cabinet (l'été d'un praticien) ferait une
alerte chaque automne. Le mois : un virement de l'Assurance maladie décalé de trois jours change le mois, l'alerte serait du
bruit. Les douze mois SEULS : lisses, mais ils retardent d'un trimestre une hausse franche — le cabinet les a voulus EN PLUS
(CA-Q3). Les douze mois recalculés chaque mois : ils donneraient un second rythme, et la marque « vue avec le client », qui vaut
pour un trimestre, ne dirait plus ce qu'elle a vu (question CA3-Q1). Le cumul seul : tait la première hausse d'une activité qui
démarre en cours d'année. « L'un ou l'autre » plutôt que « tous » : une variation du trimestre qui ne tient qu'à un
encaissement décalé se voit tout de suite à côté du cumul et des douze mois, et se marque vue d'un geste ; une variation
manquée ne se rattrape pas (CA-Q1). Une baisse au même seuil que la hausse : le cabinet a voulu un seuil à part (CA-Q2).

**Quand rien ne se juge.** Sans aucun seuil : rien, et aucune lecture de plus. Un seul trimestre se juge, le dernier clos au
jour de Paris, et seulement quand ses trois mois sont au relevé (un mouvement au moins dans chacun, la règle des mois reçus de
la Vue d'ensemble) et qu'aucun de ses crédits n'est encore à traiter : sinon il est « en attente », dit discrètement. Une
comparaison ne se fait que si ses deux périodes sont ainsi complètes — tous leurs mois au relevé, aucun crédit à traiter — et
que la période d'un an plus tôt a des recettes : sinon elle est « non comparable » (un dossier ouvert cette année, une année
d'avant importée à partir de juin). Les douze mois demandent donc deux ans de relevé, mois par mois : tant qu'ils manquent,
la phrase des douze mois le dit dans l'alerte, et le trimestre et le cumul se jugent quand même. Une lecture partielle ne se
juge jamais : une ligne discrète le dit, jamais un « pas de hausse » ni un « pas de baisse ». Tant que le relevé du dernier
trimestre manque, l'alerte du trimestre d'avant ne revient pas : elle s'est dite pendant trois mois.

## 2. D'où vient le chiffre

Du **moteur de l'estimation**, et d'aucun autre (CA-Q5 (A)) : `chiffreDAffairesDeLaPeriode` (`src/lib/estimation.ts`), sorti de
`totauxPourAnnee` et `projectionAnnuelle` sans changer un caractère de leur calcul (les quatre termes dans le même ordre). Ce
sont les recettes encaissées d'un BNC en trésorerie (CGI, art. 93, 1, que la 2035 et l'estimation citent déjà) : les pièces de
vente à la date de leur encaissement, les recettes affectées du relevé, les ventes facturées (au mois près) et les espèces de
la caisse — les entrées que l'onglet Estimation lit, assemblées comme lui (`chiffreDAffairesDesSources`). Le chiffre est donc
celui que le cabinet voit déjà comparé à l'année d'avant dans l'onglet Estimation, sur n'importe quelle période de mois
entiers — douze mois à cheval sur deux années civiles compris. Il compte toute recette, quelle que soit sa catégorie : la
ligne 1 de la 2035 (case AA) seule, ou le montant net des recettes (case AD, rétrocessions déduites), serait un autre chiffre.

## 3. Les seuils, par dossier

`seuils_du_chiffre_d_affaires` : une ligne par dossier, deux colonnes — `seuil_de_hausse`, un pour cent entier de 1 à 1 000, et
`seuil_de_baisse`, de 1 à 100 (au-delà, le chiffre d'affaires serait tombé sous zéro ; 100 % : il est tombé à zéro) —, chacune
nulle s'il n'y a pas d'alerte dans ce sens ; pas de ligne, pas d'alerte ; pas de défaut du cabinet (« il est différent » d'un
dossier à l'autre). Chaque seuil se règle **à part** (CA-Q2 (C)), par le cabinet du dossier seul (`admin_du_dossier` : le
chef, un membre affecté — CA-Q4 (A)), par `regler_seuil_du_chiffre_d_affaires(dossier, sens, seuil lu, seuil)`, qui n'écrit
que le seuil de son sens, contre SA valeur lue (40001) : l'autre n'est ni jugé ni touché. Le dernier réglage de la ligne —
qui, quand, l'un ou l'autre seuil — est posé par la base (garder l'auteur de chaque seuil : question CA2-Q1). Le client n'en
lit rien. Écran : une petite carte de l'onglet Informations, un formulaire
par seuil.

## 4. Où l'alerte paraît

- **La Vue d'ensemble du dossier** : un point d'attention au-dessus des tuiles, comme l'avis d'un changement de RIB — pas une
  ligne de « Travail à effectuer » : ce n'est pas une anomalie du dossier, la tuile « Anomalies » ne la compte pas, la
  validation d'un exercice ne la lit pas (jamais bloquante), et la révision ne la range dans aucun cycle. Son titre dit le
  sens (« Hausse du chiffre d'affaires », « Baisse du chiffre d'affaires », ou « Variation du chiffre d'affaires » quand deux
  comparaisons vont en sens contraires). Sa lecture est la sienne ; sa panne ne tait qu'elle.
- **Le tableau de bord du cabinet** : une ligne par dossier que le compte suit (la liste que le cabinet lui ouvre : le chef,
  et le membre affecté au dossier — CA-Q4 (A)) dont l'alerte n'est pas marquée vue, qui mène à sa Vue d'ensemble. Son coût,
  écrit : les seuils se lisent d'une requête, puis chaque dossier qui a au moins un seuil lit ses entrées entières, l'un après
  l'autre, au plus dix par ouverture (`PLAFOND_DU_TABLEAU_DE_BORD`) ; au-delà, la ligne le dit. Pour le MVP, un dossier.
  Au-delà d'une dizaine de dossiers réglés, ce calcul se mesure et se remplace — par exemple par le chiffre de chaque trimestre
  tiré une fois, à la clôture du trimestre, sur un geste du cabinet (une décision à prendre ce jour-là, pas maintenant).
- Rien n'est montré au client, aucun e-mail ne part.

## 5. Ce que le comptable en fait

Dans ce lot : **la marque « vue avec le client »**, d'un geste, pour le trimestre jugé (une confirmation qui le nomme). Elle
vaut pour l'alerte du trimestre, dans les deux sens et sur les trois comparaisons : l'alerte de ce trimestre se tait alors,
dans la Vue d'ensemble et sur le tableau de bord ; la carte d'Informations garde les trimestres vus, avec la date et l'auteur.
Retenue dans ce lot parce que, sans elle, l'alerte resterait trois mois à l'écran une fois traitée, et que la marque datée
garde la trace de ce que le cabinet a vu avec son client. `hausses_vues_avec_le_client` : une ligne par dossier et par
trimestre clos, son auteur et son instant posés par la base (le super-administrateur, qui restaure, garde ceux qu'il écrit) ;
elle ne se modifie ni ne se retire, et part avec son dossier.

## 6. Ce qui n'est pas fait

Rien au client ; aucun e-mail ; aucun conseil écrit par l'application ; aucune note libre avec la marque ; aucun calcul en base
(le TypeScript testé ne se réécrit pas en SQL) ; la 2035, la CA3 et le FEC n'en sont pas touchés ; les douze mois ne se
recalculent pas chaque mois (CA3-Q1). Limite écrite : un mois se dit au relevé sur l'ensemble du dossier ; le jour où plusieurs
comptes bancaires seront ouverts (`COMPTES_BANCAIRES_PREVUS`), il se jugera compte par compte.

## 7. La mise en production

La migration est additive et ne contient aucune suppression : elle passe par l'outil (`apply_migration`), sur l'accord du
cabinet (CA-migration (A), donné le 16/11/2026, une fois CA-Q2 et CA-Q4 intégrées : c'est fait). Ce qu'elle crée : deux
tables (`seuils_du_chiffre_d_affaires`, ses deux seuils ; `hausses_vues_avec_le_client`), deux fonctions aux droits de
l'appelant, deux gardes, leurs policies (le cabinet du dossier, aucune branche client), la restrictive `deux_facteurs` si la
double authentification est en base. Puis le fichier entre dans l'export sous la version de sa ligne d'historique, texte
inchangé, `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` se lève (les deux tables entrent au plan de sauvegarde, les trois écrans
s'ouvrent), et se rejouent l'essai `hausseDuChiffreDAffaires.sql`, `rls.sql` et les trois contrôles de l'export. Aucune Edge
Function à déployer. Le retour retire les deux tables et se refuse tant qu'elles portent une ligne.
