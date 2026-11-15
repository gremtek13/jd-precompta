# 52 — L'alerte de hausse du chiffre d'affaires d'un dossier

Conçue le 15/11/2026, au MVP (un premier dossier BNC réel, un praticien en trésorerie). La demande du cabinet, dictée le
15/11/2026 : « une alerte, peut-être trimestrielle, sur quand le chiffre d'affaires augmente. Après le pourcentage, c'est
l'expert-comptable qui le décide sur chaque dossier […] ça met une alerte sur le dossier pour que le comptable qui s'en occupe,
il voit avec le client ». Sa précision du même jour : l'alerte ne fait que SIGNALER la hausse ; ce que l'expert-comptable en dit
au client (« peut-être de réinvestir ou quoi que ce soit »), il le décide. Les mots de l'alerte restent donc neutres : le
constat, les deux chiffres comparés, le seuil du dossier — jamais un conseil.

Le code : `src/lib/hausseDuChiffreDAffaires.ts` (pur), `src/lib/hausseDuChiffreDAffairesLecture.ts` (la lecture), la migration
préparée `supabase/preparees/20261115140000_hausse_du_chiffre_d_affaires.sql` et son retour, les essais
`supabase/essais/hausseDuChiffreDAffaires.sql` et `hausseDuChiffreDAffairesSuppression.sql`, trois écrans derrière
`HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE`, baissé.

## 1. Ce qui se compare à quoi

**Retenu.** À la fin de chaque trimestre civil (le rythme : question CA-Q3), deux comparaisons, chacune contre l'année d'avant :

- les recettes encaissées du **trimestre écoulé** contre celles du même trimestre de l'année d'avant ;
- le **cumul depuis le 1er janvier** jusqu'à la fin de ce trimestre contre le cumul de l'année d'avant à la même date (au
  1er trimestre, le cumul est le trimestre : une seule comparaison ; au 4e, c'est l'année entière).

L'alerte se dit quand **l'une ou l'autre** hausse **atteint** le seuil (≥), jugée exactement en centimes entiers :
(N − P) × 100 ≥ seuil × P, P strictement positif. La variation montrée l'est au dixième de point ; un arrondi d'affichage ne
décide rien (19,96 % se montre 20,0 % et n'atteint pas 20 %).

**Écartés.** Le trimestre contre le trimestre précédent : la saisonnalité d'un cabinet (l'été d'un praticien) ferait une
alerte chaque automne. Le mois : un virement de l'Assurance maladie décalé de trois jours change le mois, l'alerte serait du
bruit. Douze mois glissants : lisse, mais retarde d'un trimestre une hausse franche. Le cumul seul : tait la première hausse
d'une activité qui démarre en cours d'année. « L'un ou l'autre » plutôt que « les deux » : une hausse du trimestre qui ne
tient qu'à un encaissement décalé se voit tout de suite à côté du cumul, et se marque vue d'un geste ; une hausse manquée
ne se rattrape pas (question CA-Q1).

**Quand rien ne se juge.** Sans seuil (nul) : rien, et aucune lecture de plus. Un seul trimestre se juge, le dernier clos au
jour de Paris, et seulement quand ses trois mois sont au relevé (un mouvement au moins dans chacun, la règle des mois reçus de
la Vue d'ensemble) et qu'aucun de ses crédits n'est encore à traiter : sinon il est « en attente », dit discrètement. Une
comparaison ne se fait que si ses deux périodes sont ainsi complètes et que l'année d'avant a des recettes : sinon elle est
« non comparable » (un dossier ouvert cette année, une année d'avant importée à partir de juin). Une lecture partielle ne se
juge jamais : une ligne discrète le dit, jamais un « pas de hausse ». Tant que le relevé du dernier trimestre manque, la
hausse du trimestre d'avant ne revient pas : elle s'est dite pendant trois mois.

## 2. D'où vient le chiffre

Du **moteur de l'estimation**, et d'aucun autre : `chiffreDAffairesDeLaPeriode` (`src/lib/estimation.ts`), sorti de
`totauxPourAnnee` et `projectionAnnuelle` sans changer un caractère de leur calcul (les quatre termes dans le même ordre). Ce
sont les recettes encaissées d'un BNC en trésorerie (CGI, art. 93, 1, que la 2035 et l'estimation citent déjà) : les pièces de
vente à la date de leur encaissement, les recettes affectées du relevé, les ventes facturées (au mois près) et les espèces de
la caisse — les entrées que l'onglet Estimation lit, assemblées comme lui (`chiffreDAffairesDesSources`). Le chiffre est donc
celui que le cabinet voit déjà comparé à l'année d'avant dans l'onglet Estimation. Il compte toute recette, quelle que soit sa
catégorie : la ligne 1 de la 2035 (case AA) seule, ou le montant net des recettes (case AD, rétrocessions déduites), serait un
autre chiffre (question CA-Q5).

## 3. Le seuil, par dossier

`seuils_du_chiffre_d_affaires` : une ligne par dossier, un pour cent entier de 1 à 1 000, nul ou absent = pas d'alerte ; pas
de défaut du cabinet (« il est différent » d'un dossier à l'autre). Réglé par le cabinet du dossier seul (`admin_du_dossier` :
le chef, un membre assigné), par `regler_seuil_du_chiffre_d_affaires`, contre la valeur lue qu'il remplace (40001) ; qui l'a
réglé et quand, posés par la base. Le client n'en lit rien. Écran : une petite carte de l'onglet Informations.

## 4. Où l'alerte paraît

- **La Vue d'ensemble du dossier** : un point d'attention au-dessus des tuiles, comme l'avis d'un changement de RIB — pas une
  ligne de « Travail à effectuer » : ce n'est pas une anomalie du dossier, la tuile « Anomalies » ne la compte pas, la
  validation d'un exercice ne la lit pas (jamais bloquante), et la révision ne la range dans aucun cycle. Sa lecture est la
  sienne ; sa panne ne tait qu'elle.
- **Le tableau de bord du cabinet** : une ligne par dossier que le compte suit (la liste que le cabinet lui ouvre ; qui la voit :
  question CA-Q4) dont
  l'alerte n'est pas marquée vue, qui mène à sa Vue d'ensemble. Son coût, écrit : les seuils se lisent d'une requête, puis
  chaque dossier réglé lit ses entrées entières, l'un après l'autre, au plus dix par ouverture (`PLAFOND_DU_TABLEAU_DE_BORD`) ;
  au-delà, la ligne le dit. Pour le MVP, un dossier. Au-delà d'une dizaine de dossiers réglés, ce calcul se mesure et se
  remplace — par exemple par le chiffre de chaque trimestre tiré une fois, à la clôture du trimestre, sur un geste du cabinet
  (une décision à prendre ce jour-là, pas maintenant).
- Rien n'est montré au client, aucun e-mail ne part.

## 5. Ce que le comptable en fait

Dans ce lot : **la marque « vue avec le client »**, d'un geste, pour le trimestre jugé (une confirmation qui le nomme).
L'alerte de ce trimestre se tait alors, dans la Vue d'ensemble et sur le tableau de bord ; la carte d'Informations garde les
trimestres vus, avec la date et l'auteur. Retenue dans ce lot parce que, sans elle, l'alerte resterait trois mois à l'écran
une fois traitée, et que la marque datée garde la trace de ce que le cabinet a vu avec son client. `hausses_vues_avec_le_client` :
une ligne par dossier et par trimestre clos, son auteur et son instant posés par la base (le super-administrateur, qui
restaure, garde ceux qu'il écrit) ; elle ne se modifie ni ne se retire, et part avec son dossier.

## 6. Ce qui n'est pas fait

Rien au client ; aucun e-mail ; aucun conseil écrit par l'application ; aucune alerte à la baisse (CA-Q2) ; aucune note libre
avec la marque ; aucun calcul en base (le TypeScript testé ne se réécrit pas en SQL) ; la 2035, la CA3 et le FEC n'en sont pas
touchés. Limite écrite : un mois se dit au relevé sur l'ensemble du dossier ; le jour où plusieurs comptes bancaires seront
ouverts (`COMPTES_BANCAIRES_PREVUS`), il se jugera compte par compte.

## 7. La mise en production

La migration est additive et ne contient aucune suppression : elle passe par l'outil (`apply_migration`), sur l'accord du
cabinet (la fiche « CA-migration »). Puis le fichier entre dans l'export sous sa version, `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE`
se lève (les deux tables entrent au plan de sauvegarde, les trois écrans s'ouvrent), et se rejouent l'essai
`hausseDuChiffreDAffaires.sql`, `rls.sql` et les trois contrôles de l'export. Le retour retire les deux tables et se refuse tant
qu'elles portent une ligne.
