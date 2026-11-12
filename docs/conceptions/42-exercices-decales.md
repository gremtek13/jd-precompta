# Les exercices décalés : la conception (ligne 42)

Ligne 42 de la feuille de route, « Exercices décalés », case « Hors BNC » : une clôture hors du 31 décembre, un premier
exercice plus court ou plus long, et le passage d'un dossier existant à une autre date de clôture. Conception rendue le
12/11/2026 par l'architecte, sans code de l'application ni écriture en base. Le récit court est dans HISTORIQUE.md, à
l'entrée « LES EXERCICES DÉCALÉS : LA CONCEPTION (LIGNE 42) ».

Ce qui se lit avant : HISTORIQUE.md → « UN EXERCICE VALIDÉ SE FIGE EN BASE », « LA VALIDATION D'UN EXERCICE ÉCRIT
L'OUVERTURE DU SUIVANT », « LA COMPTABILITÉ D'ENGAGEMENT (BIC, IS), ÉTAPE 1 », « LE BILAN SE LIT DANS LES RUBRIQUES DU
2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE », « LA RÉVISION DES COMPTES : LA CONCEPTION », « INAL1 ET
INAL2 : LA PIÈCE FIGÉE DANS LE STOCKAGE ET L'EMPREINTE EN FORME 2 », « LA VALIDATION D'UN GROS EXERCICE : LES GARDES
ALLÉGÉES », « ET AU 1ER JANVIER, LES TROIS ÉCRANS » ; et `docs/conceptions/35-inventaire.md` (le 31 décembre de ses
écritures et le 1er janvier de ses extournes deviennent les bornes de l'exercice).

## 0. En quinze lignes

1. Aujourd'hui l'exercice EST l'année civile, partout : un entier `annee`, et ses bornes déduites (`${annee}-01-01`,
   `${annee}-12-31`, `extract(year from date)`, `make_date(annee, 12, 31)`). La décision du cabinet du 28/09/2026 l'a
   voulu (« l'exercice reste l'année civile », `lib/engagement.ts`).
2. L'étendue, mesurée le 12/11/2026 : 51 des 300 fonctions SQL de `public` lisent l'année d'une date, 65 portent une
   borne civile, 32 passent par `frontiere_validation` ; 31 déclencheurs gardent le gel sur 16 tables ; 20 tables ont
   une colonne d'année ; 162 fichiers de `src` (117 de `src/lib`, 44 de `src/pages`) et 4 Edge Functions portent au
   moins un marqueur d'année civile (borne haute : une partie reste civile à bon droit).
3. Un BNC reste civil, et la 2035 avec lui : le bénéfice d'un BNC est celui de l'année (CGI art. 12 et 93), l'option
   « créances-dettes » (art. 93 A) n'y change rien. Un dossier en TRÉSORERIE n'a jamais d'exercice décalé : la base le
   refuse. Les quatre dossiers de la base sont en trésorerie ; aucun n'est touché.
4. L'exercice devient une DONNÉE du dossier en engagement : une table `exercices` (début, fin, nature : premier,
   ordinaire, transition), jamais déduite du calendrier ; une écriture hors d'un exercice déclaré se refuse.
5. Une seule fonction dit les bornes d'un exercice et l'exercice d'une date, pour les deux modes
   (`bornes_de_l_exercice`, `exercice_de_la_date`) : civiles par la loi en trésorerie, lues dans la table en engagement.
6. L'exercice garde son nom entier, le MILLÉSIME DE SA CLÔTURE (l'exercice clos le 30/06/2027 est « 2027 ») ; toutes les
   tables et fonctions qui portent `annee` le gardent (EXD-Q1). Le prix : deux clôtures dans la même année civile se
   refusent, donc la transition courte qui ramène au 31 décembre aussi.
7. Le gel ne change pas de nature : il est déjà une DATE (`frontiere_validation`), qui devient la fin du dernier exercice
   validé au lieu de `make_date(max(annee), 12, 31)`. Le corps des 31 déclencheurs ne change pas ; leurs messages oui.
8. `valider_exercice`, `soldes_a_reporter`, `solde_du_compte`, l'empreinte (une forme 3 pour l'exercice décalé, la forme 2
   intacte pour l'exercice civil), `phase_des_exercices` et les fonctions qui lisent `extract(year …)` passent aux bornes.
9. Ce qui reste civil le dit : la 2035, la CA3 (mois, trimestre), l'e-reporting, la numérotation des factures et des
   devis, les cotisations, la CFE ; l'échéancier de la liasse et de l'impôt sur les sociétés suit la clôture.
10. Le FEC porte la date de clôture dans son nom (`SirenFECAAAAMMJJ`) ; les à-nouveaux s'écrivent au premier jour de
    l'exercice ; les dotations et les écritures d'inventaire au dernier, au prorata de sa durée réelle.
11. Le passage d'un dossier existant : une décision datée (l'assemblée qui change la clôture), un exercice de transition
    déclaré, jamais un exercice validé réécrit.
12. Huit lots, environ vingt-deux jours, derrière deux drapeaux (`EXERCICES_DECALES_PREVUS`, `EXERCICES_DECALES_EXPORTES`) ;
    trois migrations non destructives, dont une qui remplace `valider_exercice` et `frontiere_validation`.
13. Le premier risque : une régression de la frontière du gel ; elle se rejoue sur les deux modes et sur les 28 essais
    qui la nomment, avant tout collage.
14. Rien ne passe avant le MVP : la ligne est « Hors BNC », après la ligne 31 (engagement) et avec la liasse (37).
15. Huit questions au cabinet, EXD-Q1 à EXD-Q8, chacune avec sa recommandation (§ 10).

---

## 1. Le constat

### 1.1 Où l'exercice est l'année civile (mesuré par `grep`, 12/11/2026)

| Endroit | Ce qui tient l'exercice pour l'année civile |
|---|---|
| `src/context/AnneeContext.tsx` | `ValeurAnnee` (un entier ou « toutes ») partagé par 13 fichiers (`useAnnee()`), dont 10 onglets ; chaque onglet filtre ses dates sur `${annee}-01-01` … `${annee}-12-31` |
| `src/pages/DossierDetail.tsx` | `calculerAnneeParDefaut` : l'année civile en cours, sinon la précédente (`new Date().getFullYear()`) ; la liste des années tirée des dates des pièces et de `exercices_valides.annee` |
| `src/lib/aNouveaux.ts` | `dateOuverture(exercice)` rend `${exercice}-01-01`, « les exercices étant civils » |
| `src/lib/fec.ts` | `nomFichierFec(siret, anneeCloture)` rend `…FEC${anneeCloture}1231.txt` |
| `src/lib/amortissements.ts` | `rang360(`${annee}-12-31`)` : l'annuité est celle de l'année civile |
| `src/lib/engagement.ts` | la règle écrite : « l'exercice reste l'année civile » (décision du 28/09/2026) |
| `src/lib/pointsDeLaChecklist.ts` | « au 1er janvier, l'exercice révolu reste réclamé en entier » ; l'écriture du 1er janvier |
| `src/lib/echeancesFiscales.ts` | la liasse au deuxième jour ouvré suivant le 1er mai : la date d'une clôture au 31 décembre |
| `src/lib/validationExercice.ts`, `prealablesValidation.ts`, `reportDesSoldes.ts`, `clotureExercice.ts`, `bilan.ts`, `revisionSoldes.ts`, `ouvertureConfrontee.ts`, `soldesReportesLecture.ts` | un `annee: number` et des bornes civiles |
| `supabase/functions/agent-comptable/index.ts` | 8 bornes civiles : la frontière (`${max}-12-31`), la dotation et le forfait au 31 décembre, les bornes d'un exercice (`date_debut: ${annee}-01-01`) |
| `supabase/functions/extract-piece`, `plateforme-agreee`, `superpdp-emit` | une année lue d'une date (numérotation, millésime d'un document) : civile à bon droit |

Comptes : 162 fichiers de `src` hors tests portent au moins un des marqueurs `-12-31`, `-01-01`, `.slice(0, 4)`,
`getFullYear()`, `useAnnee(`, `annee: number`, `exercice: number`, `anneeDe(` (117 dans `src/lib`, 44 dans `src/pages`) ; 83
modules de `src/lib` prennent un `annee: number` ou un `exercice: number`. C'est une BORNE HAUTE : la CA3, l'e-reporting,
les cotisations, la numérotation des factures et l'échéancier de la CFE lisent l'année civile et doivent la garder.

### 1.2 L'état réel de la base (lu le 12/11/2026, en lecture seule, catalogue et comptes seulement)

- 300 fonctions dans `public` ; 65 portent une borne civile (`12-31`, `01-01`, `make_date`, `extract(year …)`,
  `date_trunc('year' …)`), dont 51 `extract(year …)` ; 68 nomment `annee` ou `exercice` ; 32 appellent
  `frontiere_validation` ; 19 lisent `exercices_valides`.
- `frontiere_validation(p_dossier_id)` : `select make_date(max(annee), 12, 31) from exercices_valides where dossier_id = …`.
  C'est le cœur du gel ; tout le reste compare une DATE à cette date (`garder_ecritures_validees` : `new.date <=
  v_frontiere`), et ne lit l'année que pour son message (`exercice_fige(dossier, extract(year from new.date))`).
- 117 déclencheurs non internes ; 31 gardent le gel (fonctions qui lisent `frontiere_validation` ou `exercices_valides`) sur
  16 tables : `a_nouveaux`, `cotisations_declarees`, `declarations_tva`, `ecritures_brouillon`, `encaissements_factures`,
  `encaissements_factures_taux`, `factures_emises`, `immobilisations`, `lignes_bancaires`, `operations_caisse`,
  `parametres_des_cotisations`, `reglements_groupes`, `saisies_2035`, `soldes_reportes`, `vehicules`,
  `ventilations_bancaires` ; 17 déclencheurs appellent une fonction qui porte une borne civile.
- `exercices_valides` : clé `(dossier_id, annee)`, `annee` entre 2000 et 2100, `mode_comptable` et `declaration` (la 2035,
  nulle en engagement) ; aucune date de début ni de fin. `exercices_clotures` : `(dossier_id, annee, cloture_le)`.
- 20 tables portent une année : `exercices_valides`, `exercices_clotures`, les six tables de la révision
  (`revision_conclusions`, `_explications`, `_justifications`, `_notes`, `_revues`, `_seuils`), `situations_publiees`,
  `saisies_2035`, `volet_social_pamc`, `parametres_des_cotisations`, `cotisations_declarees.annee_payee`, `vehicules`,
  `references_annuelles`, `references_postes_annuels`, `previsionnels_bancaires.annee_reference`,
  `facture_numerotation`, `devis_numerotation`, `continuite_des_series`. Les neuf premières sont des années d'EXERCICE ;
  les autres sont civiles par nature (cotisations, numérotation, barème, références) et le restent.
- `dossiers` n'a aucune date de clôture ; `mode_comptable` dit le modèle. Quatre dossiers, tous en trésorerie ; zéro ligne
  dans `exercices_valides` et dans `exercices_clotures`.
- Les extensions : `btree_gist` n'est PAS installée, mais disponible (utile à une contrainte d'exclusion, § 4.1).
- 28 fichiers de `supabase/essais/` nomment `frontiere_validation` ou `exercices_valides`.

### 1.3 Ce qui manque

Une date de clôture statutaire, un premier exercice d'une autre durée, un exercice de transition, et une seule source de
vérité pour « quel exercice contient cette date ». Le gel, lui, est déjà juste en principe : il compare des dates.

## 2. Les sources

- **Code de commerce**, art. L123-12 (comptes annuels « à la clôture de l'exercice », inventaire « au moins une fois tous
  les douze mois ») et L123-13 ; art. R123-… sur la durée de l'exercice — texte consolidé :
  https://www.legifrance.gouv.fr/codes/id/LEGITEXT000005634379. La date de clôture est fixée par les statuts ; sa
  modification est une décision de l'assemblée qui modifie les statuts.
- **Code général des impôts** (https://www.legifrance.gouv.fr/codes/id/LEGITEXT000006069577) :
  - art. 12 : l'impôt est dû chaque année sur les revenus de cette année — la règle par défaut ;
  - art. 36 et 37 (BIC) : le résultat de l'exercice clos au cours de l'année ; plusieurs exercices clos la même année
    sont totalisés ; une année sans clôture appelle une imposition de la période écoulée ;
  - art. 209, I (IS) : le bénéfice est celui de l'exercice, selon les règles des art. 34 à 45 ;
  - art. 93 et 96 à 100 (BNC, déclaration contrôlée) : le bénéfice de l'année civile, la 2035 ; art. 93 A : l'option pour
    les créances acquises et les dépenses engagées, qui ne déplace pas la période ;
  - art. 223 : la déclaration de résultat d'une société à l'IS dans les trois mois de la clôture (le deuxième jour ouvré
    suivant le 1er mai pour une clôture au 31 décembre) ; art. 1668 : les acomptes et le solde de l'IS, datés depuis la
    clôture ;
  - art. 1586 sexies (CVAE) : la valeur ajoutée de l'exercice de douze mois clos au cours de l'année d'imposition.
- **BOFiP** (https://bofip.impots.gouv.fr/) : BOI-BIC-BASE-10-10 (la période d'imposition des BIC, les exercices de durée
  autre que douze mois, la tolérance qui dispense une entreprise nouvelle de bilan l'année de sa création si son premier
  exercice se clôt au plus tard le 31 décembre de l'année suivante) ; BOI-IS-DECLA-20-10 (acomptes et solde de l'IS) ;
  BOI-CF-IOR-60-40-20 (le FEC, dont le nom `SirenFECAAAAMMJJ`, AAAAMMJJ la date de clôture).
- **Livre des procédures fiscales**, art. L47 A et A47 A-1 (le FEC, un fichier par exercice) :
  https://www.legifrance.gouv.fr/codes/id/LEGITEXT000006069583.
- **PCG** (règlement ANC n° 2014-03, recueil consolidé au 1er janvier 2026, https://www.anc.gouv.fr/) : art. 214-13
  (l'amortissement court à compter de la mise en service, au prorata du temps) ; art. 1214-40, 1214-41, 1214-48 (les
  régularisations contre-passées à l'ouverture de l'exercice suivant — l'ouverture, non le 1er janvier).

Les numéros d'articles et de paragraphes sont ceux des conceptions précédentes et de la mémoire de l'architecte ; leur
texte se relit avant EXD2 (§ 9).

## 3. Les principes

### 3.1 L'exercice est une donnée du dossier en engagement

Un dossier en engagement a une liste d'exercices DÉCLARÉS : un début, une fin, une nature (`premier`, `ordinaire`,
`transition`). Ils se suivent sans trou ni chevauchement ; le premier commence au début de l'activité ou à la reprise.
Aucun ne se déduit du calendrier : l'application PROPOSE le suivant (la fin de l'actuel plus un jour, jusqu'à la même
date de clôture l'année d'après), le clic du cabinet le déclare. Une écriture, une pièce ou un mouvement daté hors de
tout exercice déclaré se refuse en base (le message nomme les bornes connues), comme une écriture sur un exercice validé.

### 3.2 Ce qui reste civil le dit

- **Un dossier en trésorerie** (BNC, 2035) : l'exercice est l'année civile PAR LA LOI (CGI art. 12 et 93), pas par
  défaut. La fonction des bornes rend `[1er janvier, 31 décembre]` sans lire la table, et la table refuse toute ligne
  pour un tel dossier (EXD-Q2). Rien ne change pour le MVP.
- **La CA3** (mois ou trimestre), **l'e-reporting** (décade, mois, bimestre), **la CFE et la CVAE**, **les cotisations**
  (l'année payée), **la numérotation** des factures et des devis (l'année de la date, G1.45), **le barème
  kilométrique** : des périodes civiles, que la ligne 42 ne touche pas. La CA12 annuelle, qui pouvait suivre
  l'exercice, disparaît au 1er janvier 2027 (`lib/declarationTva.ts`) : rien à concevoir.
- **La 2035** : hors de la ligne, par construction (§ 3.2, premier point).

### 3.3 L'exercice garde un nom entier : le millésime de sa clôture

L'exercice clos le 30/06/2027 s'appelle « 2027 », comme le fait déjà le nom du FEC (sa date de clôture) et comme la
pratique fiscale (« l'exercice clos en 2027 »). Toutes les colonnes `annee` des neuf tables d'exercice, la clé de
`exercices_valides`, `useAnnee()` et les 83 modules qui prennent un `annee: number` le gardent : seules leurs BORNES
changent. Le prix : deux exercices ne peuvent pas se clore la même année civile (EXD-Q1). La table le garde par une clé
unique `(dossier_id, extract(year from fin))`.

### 3.4 Une fonction, deux régimes, une seule source

`bornes_de_l_exercice(dossier, annee)` et `exercice_de_la_date(dossier, date)` sont les SEULES à savoir ce qu'est un
exercice ; leur jumeau pur `lib/exercices.ts` est confronté au texte exporté et rejoué par un essai, comme tout module qui
redit une fonction SQL. Un `extract(year from …)` qui veut dire « l'exercice de » devient un appel à
`exercice_de_la_date` ; un `make_date(annee, 12, 31)` ou un `${annee}-12-31` qui veut dire « la fin de l'exercice »
devient la borne. Un scanner (`exercicesCivilsEnDur.test.ts`, EXD4) part de TOUT `src` et refuse une borne civile en dur
hors d'une liste d'exceptions motivées et comptées (la CA3, l'e-reporting, la numérotation…), avec un plancher.

### 3.5 Le gel reste une date

`frontiere_validation` devient « la fin du dernier exercice validé » : `select max(x.fin) from exercices_valides v join
… ` (la fin lue par `bornes_de_l_exercice`). Les 31 déclencheurs comparent déjà `date <= frontière` : leur logique ne
change pas, leur message passe par `exercice_de_la_date`. C'est le choix le moins risqué : la garde la plus éprouvée de la
base garde sa forme.

### 3.6 Le passage d'un dossier existant : l'exercice de transition

Changer la date de clôture est une DÉCISION (l'assemblée qui modifie les statuts, ou l'exploitant individuel), datée,
citée au dossier permanent (R5). Elle ne touche jamais un exercice validé ; elle redéclare l'exercice EN COURS (non
validé) en exercice de transition, de son début à la nouvelle date de clôture, puis les suivants sur la nouvelle date.
Sous EXD-Q1 (A), la transition qui se clôturerait la même année civile que l'exercice précédent se refuse : elle
s'allonge jusqu'à la nouvelle date l'année suivante (EXD-Q4). Une transition ne déplace aucune écriture : elle refuse
seulement si une écriture déjà passée sortirait de tout exercice.

### 3.7 La durée réelle

Les dotations (art. 214-13) se calculent au prorata de la durée réelle de l'exercice : `rang360(fin) - rang360(début - 1)`
au lieu de 360 ; une annuité d'un exercice de 18 mois vaut 540/360 de l'annuité. Le bilan dit la durée de chaque colonne
(N et N−1 n'ont plus la même) ; la révision ne dit aucune variation « anormale » entre deux durées différentes sans la
nommer. Les écritures d'inventaire (conception 35) se datent à la fin de l'exercice, leurs extournes à son lendemain.

## 4. Le schéma (indicatif ; aucune migration préparée)

### 4.1 `exercices` (EXD2)

```sql
create table public.exercices (
  id          uuid primary key default gen_random_uuid(),
  dossier_id  uuid not null references public.dossiers(id) on delete cascade,
  debut       date not null,
  fin         date not null,
  nature      text not null check (nature in ('premier', 'ordinaire', 'transition')),
  decision    text,             -- la décision qui a changé la clôture (transition), citée au dossier permanent
  decision_le date,
  declare_le  timestamptz not null default now(),
  declare_par uuid not null,
  constraint exercices_bornes check (debut < fin and fin <= (debut + interval '24 months')::date),
  constraint exercices_transition_motivee check ((nature = 'transition') = (decision is not null and decision_le is not null)),
  constraint exercices_un_millesime unique (dossier_id, annee_de_cloture)  -- colonne générée : extract(year from fin)
);
-- Ni trou ni chevauchement : une exclusion sur daterange (btree_gist, à installer) pour le chevauchement,
-- la contiguïté par la garde (fin + 1 = debut du suivant), le premier exercice sans prédécesseur.
```

- La garde (`garder_exercices`, déclencheur) : refuse un dossier en trésorerie (`exercices_hors_tresorerie`), un trou,
  un exercice qui laisserait une écriture, une pièce ou un mouvement hors de tout exercice, toute modification d'un
  exercice validé ou d'un exercice qui le précède ; un ordinaire de plus ou de moins de douze mois ; un premier qui se
  clôt après le 31 décembre de l'année qui suit son début (EXD-Q3).
- Les écritures passent par `declarer_exercice` et `changer_date_de_cloture` seules (`security definer`, l'accès vérifié
  avant toute lecture, `revoke … from public, anon`), sous le verrou de la validation (`cle_validation`).
- La policy : `for select to authenticated using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id,
  'membre'))` — le client lit les bornes de ses exercices (« Mon échéancier », « État du dossier ») ; aucune policy
  d'écriture. La future policy `deux_facteurs` la couvre comme toute table.
- Au plan de sauvegarde derrière `EXERCICES_DECALES_PREVUS` (`auPlanAujourdHui`), avant `exercices_valides` dans l'ordre
  de restauration.

### 4.2 Les fonctions de lecture

```sql
-- Les bornes : civiles par la loi en trésorerie, déclarées en engagement ; null si l'exercice n'est pas déclaré.
create function public.bornes_de_l_exercice(p_dossier_id uuid, p_annee integer)
returns table (debut date, fin date) language sql stable security definer set search_path = public as $$
  select make_date(p_annee, 1, 1), make_date(p_annee, 12, 31)
    from dossiers d where d.id = p_dossier_id and d.mode_comptable = 'tresorerie'
  union all
  select e.debut, e.fin from exercices e join dossiers d on d.id = e.dossier_id
   where e.dossier_id = p_dossier_id and d.mode_comptable = 'engagement' and extract(year from e.fin) = p_annee
$$;

-- L'exercice d'une date : son millésime de clôture, ou null hors de tout exercice déclaré.
create function public.exercice_de_la_date(p_dossier_id uuid, p_date date) returns integer …;

-- Le gel : la fin du dernier exercice validé.
create or replace function public.frontiere_validation(p_dossier_id uuid) returns date …
  select max(b.fin) from exercices_valides v cross join lateral bornes_de_l_exercice(v.dossier_id, v.annee) b
   where v.dossier_id = p_dossier_id;
```

Le contrôle d'accès des deux lectures suit celui de `frontiere_validation` (appelée par des fonctions qui ont déjà
contrôlé) ; leur `execute` n'est accordé qu'à `authenticated`, et leur essai vérifie qu'elles ne rendent rien d'un autre
dossier.

### 4.3 `exercices_valides`

La clé `(dossier_id, annee)` reste. Deux colonnes s'ajoutent, `debut` et `fin`, FIGÉES à la validation (copiées des bornes,
NOT NULL après remplissage — aucune ligne aujourd'hui) : l'exercice validé ne dépend plus de la table `exercices` pour se
relire, et l'empreinte les scelle. Un contrôle : en trésorerie, `debut` et `fin` sont le 1er janvier et le 31 décembre de
`annee` ; en engagement, `extract(year from fin) = annee`.

### 4.4 L'empreinte

La forme 2 (INAL2) ne change pas d'un octet pour un exercice civil : une forme 3 n'est produite que pour un exercice
dont les bornes ne sont pas civiles, et elle scelle `debut` et `fin` en plus (`forme_empreinte in (1, 2, 3)`). Ainsi une
validation civile d'avant et d'après EXD3 donne la même empreinte (essai `empreinteDesExercices.sql` rejoué sans
changement).

### 4.5 `valider_exercice` et les fonctions qui lisent l'année d'une date

`valider_exercice(p_dossier_id, p_annee, …)` garde sa signature ; elle lit les bornes, refuse un exercice non déclaré
(engagement) ou dont le précédent n'est pas validé, sélectionne ses lignes par `date between debut and fin` au lieu de
`extract(year from date) = p_annee`, date l'ouverture du suivant à `fin + 1` (le report des soldes : `soldes_a_reporter`,
`soldes_reportes.date`), et fige `debut` et `fin`. Les 51 fonctions qui lisent `extract(year …)` se répartissent en trois
familles, à relever une par une dans EXD3 : « l'exercice de cette date » (→ `exercice_de_la_date` : la validation, le gel,
`exercice_figeant_la_piece`, `exercice_figeant_la_facture_source`, `ventes_facturees_de_l_exercice`, la révision,
`phase_des_exercices`, `solde_du_compte`, `soldes_a_reporter`, `dotation_amortissement`) ; « l'année civile de cette
date » (inchangé : la numérotation, la TVA, l'e-reporting, les cotisations, le barème) ; un message seulement (→ la
fonction, le texte dit « l'exercice clos le … »).

### 4.6 `phase_des_exercices`

Elle prend « l'exercice en cours » comme celui qui contient aujourd'hui (à Paris) et le précédent, au lieu de l'année
civile et de la précédente. Au lendemain d'une clôture au 30 juin, l'exercice qui vient de se clore reste réclamé, comme
aujourd'hui au 1er janvier.

## 5. Les effets ailleurs

### 5.1 La 2035, la CA3, l'e-reporting, les cotisations

Aucun : ils vivent en trésorerie ou sur des périodes civiles (§ 3.2). Le scanner d'EXD4 les liste parmi ses exceptions,
chacune motivée.

### 5.2 Les écrans

`AnneeContext` garde `ValeurAnnee` (le millésime) ; `AnneeTabs` affiche « 2027 » pour un exercice civil, « 2027 (clos le
30/06) » pour un autre (EXD-Q7) ; les dix onglets qui filtrent par `${annee}-01-01` passent par `bornesDe(annee)` lues une
fois par dossier (`lib/exercicesLecture.ts`, `lireTout`, une lecture partielle n'affiche rien) ; `calculerAnneeParDefaut`
prend l'exercice qui contient aujourd'hui. Une carte « Exercices » dans l'onglet Informations : la date de clôture,
la liste, « Déclarer l'exercice suivant », « Changer la date de clôture » (confirmation qui nomme l'exercice redéclaré,
ses bornes et la décision). « Nouveau dossier » en engagement demande le premier exercice.

### 5.3 Le FEC, la piste d'audit, les à-nouveaux

`nomFichierFec(siret, fin)` prend la date de clôture (`…FEC20270630.txt`) ; les à-nouveaux au premier jour
(`dateOuverture(debut)`) ; le FEC d'un exercice décalé ne porte que les écritures de ses bornes.

### 5.4 Les amortissements, l'inventaire, le bilan

`dotation_amortissement` et `lib/amortissements.ts` : `rang360(fin)` au lieu de `rang360(${annee}-12-31)`, et le cumul
d'ouverture à `rang360(debut - 1)` ; le cumul reste arrondi, pas l'annuité. La conception 35 écrit ses opérations « au 31
décembre » et ses extournes « au 1er janvier » : à lire « à la fin de l'exercice » et « à son lendemain » (§ 3.7). Le
bilan dit la durée de N et de N−1 ; l'ouverture confrontée (`ouvertureConfrontee.ts`) compare la clôture de N−1 à
l'ouverture du lendemain, quelle que soit la date.

### 5.5 La révision, la Checklist, la Clôture

Les six tables de la révision restent par millésime ; leurs bornes viennent de la fonction. Le point « au 1er janvier,
l'exercice révolu reste réclamé » devient « au lendemain de la clôture » (`pointsDeLaChecklist.ts`) ; le rappel du relevé
de janvier suivant (Clôture, MVPD7-Q5) devient celui du mois qui suit la clôture.

### 5.6 L'échéancier

`lib/echeancesFiscales.ts` reste civil pour la CFE, la CVAE et la liasse d'une clôture au 31 décembre ; pour un dossier à
l'IS ou au BIC d'exercice décalé, la liasse se date au plus tard trois mois après la clôture (art. 223) et l'IS selon
l'art. 1668 — seulement quand l'impôt sur les sociétés existera dans l'application (ligne 33) ; EXD7 n'écrit que la
liasse.

### 5.7 L'assistant

Ses 8 bornes civiles (`supabase/functions/agent-comptable/index.ts` : la frontière `${max}-12-31`, `dateDeLaDotation`,
`dateDuForfait`, les bornes d'un exercice) passent par une copie gardée de `lib/exercices.ts` (bornes `── DÉBUT/FIN …`,
`…Copie.test.ts`), qui lit les bornes au jeton de l'appelant ; redéploiement par sa ligne d'import.

### 5.8 La sauvegarde, la restauration, le départ d'un client

`exercices` entre au plan de sauvegarde avant `exercices_valides` ; la restauration le réinsère au super-administrateur
seul (la garde le permet, comme pour les autres tables gardées). Le paquet d'archive (INAL5) nomme ses exercices par
leurs bornes.

## 6. Les lots

| Lot | Contenu | Jours | Drapeau | Dépend de |
|---|---|---|---|---|
| EXD1 | `lib/exercices.ts`, pur : bornes, exercice d'une date, suite proposée, refus (trou, chevauchement, millésime en double, premier trop long, transition), libellés, prorata 30/360 ; ses tests | 1,5 | aucun (module) | — |
| EXD2 | Migration `exercices_du_dossier` : la table, `btree_gist`, la garde, `declarer_exercice`, `changer_date_de_cloture`, `bornes_de_l_exercice`, `exercice_de_la_date`, la policy ; `exercices.sql`, `rls.sql` ; sauvegarde ; `types.ts` | 3 | `EXERCICES_DECALES_PREVUS` baissé | EXD1 |
| EXD3 | Migration `exercices_bornes_lues` : `frontiere_validation`, `valider_exercice`, `soldes_a_reporter`, `solde_du_compte`, l'empreinte (forme 3), `phase_des_exercices`, `exercice_figeant_*`, `dotation_amortissement`, les messages des 31 déclencheurs ; `exercices_valides.debut`/`fin` ; les 28 essais rejoués | 5 | le même | EXD2 |
| EXD4 | Les moteurs : `bornes` en paramètre obligatoire (validation, préalables, report des soldes, à-nouveaux, FEC, amortissements, bilan, révision, Clôture, Checklist, situation) ; le scanner `exercicesCivilsEnDur.test.ts` | 5 | le même | EXD3 |
| EXD5 | Les écrans : `AnneeTabs`, `DossierDetail`, les dix onglets, la carte « Exercices », « Nouveau dossier » ; tests d'écran ; captures | 3 | `EXERCICES_DECALES_EXPORTES` baissé | EXD4 |
| EXD6 | Le changement de date de clôture d'un dossier existant (transition), sa confirmation, la décision au dossier permanent | 1,5 | le même | EXD5 |
| EXD7 | L'assistant (copie gardée, redéploiement), l'échéancier de la liasse d'un exercice décalé | 1,5 | — | EXD4 |
| EXD8 | La mise en production : simulation (fichiers posés, drapeaux levés, suite entière), collage, trois contrôles, `rejouer.py`, essais, drapeaux levés | 1 | levés | tout |

Environ vingt-deux jours (trente-deux sous EXD-Q1 (B)). L'ordre : EXD1 → EXD2 → EXD3 → EXD4 → (EXD5 → EXD6 ∥ EXD7) →
EXD8. EXD2 et EXD3 se préparent et se rejouent sur une réplique en PostgreSQL 17 (ICU `en-US`), jamais appliqués avant
l'accord du cabinet ; EXD3 demande toute la rigueur (mutations, banc du leurre), les deux modes, et une batterie qui
confronte `frontiere_validation` d'avant et d'après sur des dossiers en trésorerie (égalité exigée).

## 7. Les risques

- **Une régression de la frontière du gel** (le premier) : `frontiere_validation` est appelée par 32 fonctions et garde 16
  tables. Une borne mal lue ouvrirait un exercice validé, ou fermerait l'exercice en cours. Parade : la nouvelle fonction
  doit rendre EXACTEMENT l'ancienne valeur pour tout dossier en trésorerie (une batterie sur la réplique, toutes les
  combinaisons de 0 à 3 exercices validés), et `gardesDeLaValidation.sql`, `validationExercice.sql`,
  `reportDesSoldes.sql`, `empreinteDesExercices.sql`, `rls.sql` se rejouent en entier.
- **`valider_exercice` remplacée** (36 Ko, la fonction la plus gardée) : déjà remplacée par la conception 35 (INV3) et par
  les gardes allégées (ligne 28.66) ; les trois chantiers ne se préparent pas en parallèle — un ordre à fixer avec la
  session (EXD3 après INV3, ou l'inverse), sinon le second collage efface le premier.
- **Un `extract(year …)` oublié** : il donnerait le mauvais exercice à une date d'un dossier décalé, en silence (les
  dossiers civils ne le verraient jamais). Parade : le relevé des 51 fonctions dans EXD3 (chacune classée dans une des
  trois familles du § 4.5, la liste dans l'essai), et le scanner côté `src` dans EXD4.
- **Les lecteurs par année** côté écran : un onglet qui garderait `${annee}-01-01` compterait six mois de trop. Le scanner
  et les tests d'écran d'un dossier décalé fictif (banc de capture : la société d8 passe à une clôture au 30 juin).
- **L'empreinte** : une forme 3 mal bornée changerait l'empreinte des exercices civils ; l'essai exige la forme 2 à
  l'identique.
- **La sauvegarde** : une table neuve ; lue avant sa migration, elle ferait échouer toute sauvegarde sans le drapeau.
- **Le retour arrière** : avant toute donnée réelle en engagement, recréer les versions précédentes des fonctions et
  baisser les drapeaux suffit ; retirer la table et les deux colonnes de `exercices_valides` serait une migration
  DESTRUCTIVE, à présenter au cabinet. Après une validation décalée, le retour arrière n'existe plus : l'exercice validé
  porte ses bornes.

## 8. Ce qui reste hors de la ligne 42

L'impôt sur les sociétés lui-même (acomptes, solde, 2065 : ligne 33), la liasse 2033 ou 2050 (ligne 37), la CVAE d'un
exercice qui n'est pas de douze mois (art. 1586 sexies, sur la 1330-CVAE), la situation intermédiaire exigée l'année sans
clôture (CGI art. 37, BIC), deux exercices clos la même année civile (sous EXD-Q1 (A)), le passage d'un dossier de la
trésorerie à l'engagement (EXD-Q8), et les comptes consolidés.

## 9. Points non vérifiés

- Le texte des articles L123-12 et L123-13 du code de commerce, de l'article réglementaire qui fixe la durée de
  l'exercice, des articles 12, 36, 37, 93, 93 A, 96, 209, 223, 1586 sexies et 1668 du CGI, de l'article 214-13 du PCG, et
  les paragraphes de BOI-BIC-BASE-10-10 (dont la tolérance du premier exercice) et de BOI-CF-IOR-60-40-20 : cités de
  mémoire, Légifrance n'ayant pas été lu article par article le 12/11/2026 ; à relire avant EXD2.
- Que l'inventaire « au moins une fois tous les douze mois » (L123-12) admette un exercice de transition de plus de douze
  mois sans inventaire intermédiaire : à confirmer par l'expert-comptable (EXD-Q4).
- La liste exacte des 51 fonctions `extract(year …)` par famille : relevée par nom ici, pas lue corps par corps.
- L'installation de `btree_gist` sur le projet (disponible, non installée) : sans elle, le chevauchement se garde par le
  déclencheur seul.
- Le comportement de `ecritures_brouillon_validation_complete` et de la numérotation (`garder_la_numerotation`) sur des
  bornes non civiles : à éprouver sur la réplique dans EXD3.

## 10. Les questions au cabinet

### EXD-Q1 — Comment s'appelle un exercice ?

- **Question** : l'exercice garde-t-il un nom entier, le millésime de sa clôture, ou devient-il un objet à part entière
  (un identifiant, ses deux dates) dans toutes les tables et fonctions ?
- **Contexte** : 20 tables, 68 fonctions et 83 modules raisonnent sur un entier. Le millésime de clôture est unique tant
  que deux exercices ne se clôturent pas la même année civile ; ce cas naît d'une transition COURTE qui avance la clôture
  dans l'année (du 31/03 au 31/12 : 01/04/2026–31/12/2026, après une clôture le 31/03/2026).
- **Options** : (A) le millésime de clôture, unique par dossier ; la transition courte de même année se refuse, elle
  s'allonge à l'année suivante ; (B) un identifiant d'exercice partout (`exercice_id`), tout permis, environ dix jours de
  plus et une migration de chaque table par année.
- **Recommandation : (A).** Elle garde intact tout ce qui est éprouvé (le gel, la révision, l'empreinte), ne coûte rien à
  un BNC, et le cas refusé a une issue légale (la transition longue) ; (B) se rouvre le jour où un client réel en a
  besoin.

### EXD-Q2 — Un dossier en trésorerie a-t-il des lignes dans la table des exercices ?

- **Question** : les exercices civils d'un BNC s'écrivent-ils dans `exercices`, ou se calculent-ils ?
- **Options** : (A) calculés par la fonction, la table refusant un dossier en trésorerie ; (B) écrits, une ligne par
  année, créée d'elle-même à la première date de l'année.
- **Recommandation : (A).** La loi les fixe (CGI art. 12 et 93) : les écrire ajouterait une écriture automatique et une
  source de désaccord, et toucherait tous les chemins de dépôt du MVP.

### EXD-Q3 — Jusqu'où va le premier exercice ?

- **Question** : quelle durée admettre pour le premier exercice d'un dossier en engagement ?
- **Options** : (A) jusqu'au 31 décembre de l'année qui suit son début (la tolérance du BOFiP pour une entreprise
  nouvelle) ; (B) vingt-quatre mois au plus ; (C) aucune borne.
- **Recommandation : (A)**, le plus court des plafonds connus, refusé au-delà avec le motif ; plus court, sans minimum.

### EXD-Q4 — L'exercice de transition : quelle durée, quelle preuve ?

- **Question** : un changement de date de clôture admet-il une transition de plus de douze mois, et que doit-il citer ?
- **Options** : (A) d'un jour à vingt-trois mois, la décision (date, nature) obligatoire et citée au dossier permanent ;
  (B) douze mois au plus ; (C) sans preuve.
- **Recommandation : (A)**, avec l'avis de l'expert-comptable sur l'inventaire intermédiaire (§ 9) ; sous EXD-Q1 (A), la
  transition longue est la seule issue d'une clôture qu'on avance dans l'année.

### EXD-Q5 — Les dotations d'un exercice qui n'est pas de douze mois

- **Question** : l'annuité suit-elle la durée réelle de l'exercice ?
- **Options** : (A) au prorata en jours 30/360 de sa durée réelle (`rang_360`), comme le cumul d'aujourd'hui ; (B) une
  annuité pleine quelle que soit la durée.
- **Recommandation : (A)**, la règle du prorata temporis (PCG art. 214-13) et la convention déjà en base.

### EXD-Q6 — Le forfait kilométrique et les autres barèmes annuels

- **Question** : dans un exercice décalé, le barème kilométrique s'applique-t-il ?
- **Options** : (A) non : l'écriture du forfait se refuse hors d'un exercice civil, le barème étant celui d'une année
  d'imposition ; (B) oui, au barème de l'année de clôture.
- **Recommandation : (A)** : le forfait est un choix de l'exploitant BNC ou BIC à l'IR sur l'année ; le deviner sur deux
  années civiles serait un calcul faux.

### EXD-Q7 — Comment l'exercice s'affiche-t-il ?

- **Question** : quel libellé dans les onglets, les PDF et le FEC ?
- **Options** : (A) « 2027 » pour un exercice civil, « 2027 (clos le 30/06) » sinon, et « du 01/07/2026 au 30/06/2027 »
  sur les états ; (B) « 2026-2027 » ; (C) « 2027 » partout.
- **Recommandation : (A)** : le millésime de clôture est le nom fiscal ; (B) dit deux années et ment pour une
  transition ; (C) tait le décalage.

### EXD-Q8 — Un dossier peut-il passer de la trésorerie à l'engagement ?

- **Question** : un BNC qui devient une société à l'IS change-t-il de modèle dans le même dossier ?
- **Options** : (A) non : un nouveau dossier (la personne change), ouvert par la balance du précédent ; (B) oui, une
  bascule datée, l'exercice civil puis un premier exercice décalé.
- **Recommandation : (A)** : le modèle ne se change déjà que sur un brouillon vide (`lib/engagement.ts`) ; une société
  nouvelle a son SIREN, son FEC et ses exercices à elle.
