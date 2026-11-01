-- LA VALIDATION D'UN EXERCICE, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche `valider_exercice`, `verifier_exercice_valide`, `empreinte_exercice`, `exercice_fige`, l'un des
-- déclencheurs qui figent un exercice validé (`garder_*`), la table `exercices_valides` ou les contraintes
-- d'`ecritures_brouillon` (ligne 26.6 de la feuille de route, étape d). Le détail du report des soldes sur
-- l'exercice suivant (ligne 34) vit dans `reportDesSoldes.sql` ; celui-ci en vérifie le montant sur ses dossiers.
--
-- Valider un exercice fige ses écritures — numérotées dans leur journal, avec ce que le FEC lit —, enregistre
-- son empreinte chaînée à celle de l'exercice validé précédent et, en trésorerie, la 2035 telle qu'elle a été
-- validée ; tout ce qui a produit ces écritures est figé avec elles, jusqu'au 31 décembre du dernier exercice
-- validé (la frontière). Ce qui se prouve ici, et ne se relit pas :
--   - QUI valide : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, un client — sur le
--     dossier d'un autre comme sur le SIEN —, un membre assigné au dossier et le chef d'un AUTRE cabinet se
--     font refuser ; le chef du cabinet valide (le contrôle POSITIF), et pas seulement parce qu'il est aussi
--     super-administrateur sur ce projet : le client, fait chef d'un cabinet jetable le temps de l'essai, valide
--     un dossier de ce cabinet-là ;
--   - CE QUI SE REFUSE, avec sa RAISON : un exercice invalide, en cours, déjà validé, sauté, antérieur à
--     l'ouverture ou postérieur à celui des à-nouveaux ; des écritures antérieures non validées — et, avant
--     l'ouverture, le conseil de les retirer ou de les redater, que l'essai suit ; un mouvement à traiter ; une
--     2035 absente en trésorerie, présente en engagement ; et chaque défaut d'une numérotation proposée — une
--     écriture à deux pièces ou à deux DATES comprise (24b, depuis le 05/10/2026) ;
--   - CE QUE LA VALIDATION ÉCRIT : les écritures validées, numérotées, avec leur pièce et le libellé de leur
--     compte ; l'exercice, ses totaux, sa 2035 et son auteur ; les libellés des à-nouveaux ; et, de
--     l'exercice suivant, son ouverture seule — les soldes de fin, reportés au centime (36b, 118b, 132b, 139b),
--     dont la validation suivante pose les libellés, faute de quoi elle se refuse ;
--   - L'INTANGIBILITÉ : une écriture validée ne change plus, même pour le propriétaire de la base ; aucune
--     écriture ne se passe avant la frontière, ni ne s'y valide à la main ; et le super-administrateur ne
--     réinsère une écriture validée que dans un dossier qui n'a encore aucun exercice validé — la restauration ;
--   - L'EMPREINTE : stable quand l'échelle d'un nombre change, elle voit une écriture ou un libellé
--     d'à-nouveau falsifiés hors déclencheur, et un maillon cassé se voit sur l'exercice suivant ;
--   - LES SOURCES FIGÉES : pièce, mouvement, part d'une ventilation ou d'un règlement groupé, bien, ligne du
--     cadre 7, échéance de cotisation et à-nouveaux — ce qui ne change plus, ce qui reste libre, et ce qui
--     ne s'ajoute plus ; une modification est jugée comme une insertion sur la frontière de SON dossier, y
--     compris quand elle fait changer une ligne de dossier ;
--   - LE REFUS DIT VRAI : une date antérieure au premier exercice validé est « figée par la validation de »
--     cet exercice, jamais « validée » ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer : les déclencheurs refusent aussi la SUPPRESSION et
--     laissent passer celle d'un dossier entier (la cascade ne voit plus le dossier), et les droits
--     d'exécution. Jouer une suppression demande une instruction que l'outil d'exécution soumet à une
--     confirmation de l'utilisateur : ces comportements-là sont éprouvés sur une réplique locale du schéma
--     (essais locaux de la session du 04/10/2026, 73 et 78 contrôles, et 24 mutations qui mordent toutes) et
--     seulement LUS ici — plus faible, et annoncé comme tel ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Tout se joue dans des dossiers JETABLES, créés dans le cabinet du dossier `test` (et un cabinet jetable),
-- au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`). Chaque contrôle s'y joue
-- dans sa propre sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict étant posé dans
-- une VARIABLE avant — le mécanisme de rls.sql ; les étapes « fait » (une validation dont la suite a besoin)
-- sont gardées jusqu'à l'annulation finale. Un refus se juge à son code ET à son message. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.validation`), que la requête finale lit : le
-- fichier se joue d'un seul appel, ne crée aucune table et ne contient aucune instruction de suppression.
--
-- Les identifiants des lignes jetables sont FIXES (préfixe `e55a1000`), pour que les requêtes se lisent ; une
-- étape les désigne par leur nom entre accolades (`{A}`, `{M1}`), remplacé avant l'exécution. Hors de l'outil
-- d'exécution, le fichier se joue en UNE transaction (`psql -1`) : le réglage qui porte les verdicts est local
-- à la transaction, et il serait vide pour la requête finale si le bloc avait déjà été validé.
--
-- JOUÉ EN PRODUCTION LE 04/10/2026, juste après la migration `frontiere_de_la_validation` : 145 contrôles sur
-- 145, et 4/1/1/77/998/3/2/1/43/0/0/0 lignes avant comme après (dossiers, cabinets, chefs et membres, pièces,
-- mouvements, écritures, biens, véhicules, échéances, à-nouveaux, exercices validés, assignations). Le texte
-- transmis, sans ses lignes de commentaire, a été comparé au fichier : identique sur 418 lignes.
--
-- REJOUÉ EN PRODUCTION LE 05/10/2026, juste après la migration `une_ecriture_une_date` : 146 contrôles sur 146 —
-- le 24b compris, refusé par « Les lignes d'une même écriture ne portent pas la même date. » —, et
-- 4/1/1/77/998/3/2/1/43/0/0/0 lignes avant comme après. Le texte transmis, sans ses lignes de commentaire, est
-- identique au fichier sur 419 lignes. Sur la réplique, la fonction d'AVANT ne fait tomber que le 24b (accepté), et
-- quatre mutations de la règle — le compte des jours pris sur la date de pièce, la pièce nommée à la place de la
-- date, deux jours admis, la règle retirée — ne font tomber que lui ; rétablie, la fonction repasse les 146.
--
-- REJOUÉ EN PRODUCTION LE 07/10/2026, juste après la migration `report_des_soldes` (ligne 34) : 151 contrôles sur
-- 151 — les cinq nouveaux compris (36b, 117a, 118b, 132b, 139b : l'ouverture de l'exercice suivant, et la validation
-- suivante qui pose ses libellés ou se refuse sans eux) —, et 4/1/1/77/998/3/2/1/43/0/0/0/0 lignes avant comme après,
-- les soldes reportés comptés en dernier. Le texte transmis, sans ses lignes de commentaire, est identique au fichier
-- sur 452 lignes. Sur la réplique, les trente-cinq mutations de la migration, jouées avec `reportDesSoldes.sql`,
-- mordent toutes. Et le harnais a été corrigé au passage : un contrôle qui attend un succès, accepté sans être
-- annulé, rendait un verdict NUL — ni vert ni rouge, qu'un décompte des contrôles faux ne voit pas. Il rend désormais
-- faux (`coalesce`) : sans l'annulation de chaque contrôle, vingt-sept contrôles tombent, dont les vingt-deux qui
-- attendent un succès.
--
-- REJOUÉ EN PRODUCTION LE 09/10/2026, juste après la migration `paiement_personnel_des_cotisations` (ligne 26.6) : 151
-- contrôles sur 151, et 4/1/1/77/998/3/2/1/43/0/0/0/0 lignes avant comme après. La lecture de la cascade (141)
-- attendait encore la liste du 07/10 au matin : `garder_factures_validees` (migration `factures_validees_figees`, le
-- 07/10 au soir), qui laisse elle aussi passer la cascade d'un dossier, y manquait — le contrôle serait tombé à tout
-- rejeu depuis —, et `garder_ecriture_paiement_personnel` s'y ajoute ; les deux sont dans la valeur attendue. Le texte
-- reçu par la base est celui de la copie transmise, ses commentaires retirés et la ligne qui dit le texte reçu
-- ajoutée (71 524 caractères, empreinte 3929d97a…).
--
-- REJOUÉ EN PRODUCTION LE 09/10/2026, après la relecture croisée du lot (28.6, R1, 26.6) et la réécriture de la lecture
-- de la cascade (141, voir plus bas) : 151 contrôles sur 151, et 4/1/1/77/998/3/2/1/43/0/0/0/0 lignes avant comme
-- après ; texte reçu égal à la copie transmise (73 922 caractères, empreinte 0da2f766…). Sur une réplique dont la
-- signature est celle de la production, la nouvelle lecture rend la valeur attendue, et sept mutations la font tomber —
-- une garde nouvelle sans la condition (par ligne, puis par instruction), la condition retirée ou tournée vers une autre
-- table, une garde désactivée, des lignes de facture dotées d'un `dossier_id`, une garde qui ne couvre plus la
-- suppression ; l'ancienne lecture n'en voyait aucune.
--
-- 11/10/2026, la lecture de la cascade (141) rattrapée sur le catalogue : elle attendait encore les 22 déclencheurs du
-- 09/10, et la production en portait 29 avant la revue analytique (ceux de R4, de la fiche hors de France et de sa
-- ventilation, du plan comptable d'un dossier, des propositions de justificatif) ; elle attend les 33 d'aujourd'hui,
-- `garder_revision_seuil` et `garder_revision_explication` (R5), `garder_regime_ereporting` et
-- `garder_ecart_ereporting` (e5a) compris — tous de la forme `dossier`. Joué sur une réplique dont `signature.sql` égale
-- la production à 118 migrations : 151 contrôles sur 151, les lignes avant comme après ; avec l'attente d'hier, le 141
-- seul tombait.
--
-- 11/10/2026, ligne 28.5, étape e5b1 (migration `declarations_ereporting`, préparée, à appliquer AVANT que ce fichier ne
-- soit fusionné) : la lecture de la cascade (141) attend 36 déclencheurs — `garder_declaration_ereporting`,
-- `garder_source_declaree` et `garder_piece_declaree` (la pièce que sa déclaration active retient, hypothèse E5-Q6), tous
-- de la forme `dossier`. Joué sur la réplique de l'étape, égale à la production à 118 migrations (signature.sql) puis
-- munie de celle-ci : 151 contrôles sur 151, 4/1/2/21/61/3/2/0/0/0/0/1/0 lignes avant comme après ; sans elle, le 141
-- seul tombe (33 déclencheurs).
--
-- 11/10/2026, ligne 41, étape R7 (migration `dossier_permanent`, appliquée le 12/10/2026 sous la version
-- `20261012070920`, avant la fusion de ce fichier) : la lecture de la cascade (141) attend 37 déclencheurs —
-- `garder_dossier_permanent`, de la forme `dossier` ; `garder_source_citee`, remplacée, garde ses deux déclencheurs.
-- Joué sur la réplique de l'étape, égale à la production à 125 migrations (signature.sql) puis munie de celle-ci : 151
-- contrôles sur 151 ; sans elle, le 141 seul tombe (36 déclencheurs). Après l'application, la production a la signature
-- de cette réplique, neuf familles sur neuf : le fichier n'y a pas été rejoué.
--
-- 20/10/2026, ligne 28.6, étape VF4b (migration `ecritures_de_la_vente_facturee`, préparée, à appliquer avant que ce
-- fichier ne soit rejoué) : la lecture de la cascade (141) attend 40 déclencheurs — G5,
-- `garder_lignes_de_la_vente_facturee`, de la forme `dossier`, et les gardes des adresses de réception et des paramètres
-- de facturation, posées depuis le 12/10/2026 sans que l'attente ne les suive (la production en compte 39 sans G5).
-- Joué en super-utilisateur sur la réplique de l'étape, égale à la production à 142 migrations (signature.sql) : sans
-- la migration, 150 contrôles sur 151, le 141 seul tombe (39 déclencheurs) ; avec elle, 151 sur 151.
--
-- 23/10/2026, ligne 28.65, étape VF6b (migration `jumelle_inversee`, préparée, à appliquer avant que ce fichier ne soit
-- rejoué) : la lecture de la cascade (141) attend 41 déclencheurs — la garde du journal des désignations,
-- `garder_designation_des_pieces`, de la forme `dossier` (elle ne laisse partir une ligne qu'avec sa pièce ou son dossier).
-- Joué en super-utilisateur sur la réplique de l'étape, égale à la production à 146 migrations plus celle de VF5h
-- (signature.sql) : sans la migration, 151 contrôles sur 152, le 141 seul tombe (40 déclencheurs) ; avec elle, 152 sur 152.
--
-- 25/10/2026, ligne 28.65, étape VF7a (migration `frontiere_des_encaissements`, appliquée le 26/10/2026, que ce
-- fichier suppose) : la lecture de la cascade (141) attend 43 déclencheurs — les deux de la frontière des
-- encaissements, `encaissements_factures_gardes_frontiere` et `encaissements_factures_taux_gardes_frontiere`, de la
-- forme `dossier` (la cascade d'un dossier qu'on supprime passe : le dossier n'est déjà plus là). Joué en
-- super-utilisateur et en une transaction sur la réplique de l'étape, égale à la production à 148 migrations plus celle
-- de VF5h2 (signature.sql) : sans la migration, 151 contrôles sur 152, le 141 seul tombe (41 déclencheurs) ; avec
-- elle, 152 sur 152 ; sans VF5h2, de même. Le texte sans ses lignes de commentaire, envoyé en une requête : 75 376
-- caractères, empreinte b24871a8cd2220469c7eac0be46cb09f, 152 justes.
--
-- MIS AU POINT SUR UNE RÉPLIQUE LOCALE, ET MUTÉ AVANT D'ÊTRE CRU. Trente-quatre mutations, chacune jouée dans
-- la transaction de l'essai puis annulée, toutes mordent :
--   - le code TEL QU'IL ÉTAIT avant la migration corrective, fonction par fonction : chacun des sept
--     déclencheurs et la validation font tomber les contrôles qui les visent — le message « validé » d'une date
--     antérieure au premier exercice, la ligne venue d'un autre dossier, la date d'acquisition avancée, la pièce
--     déjà validée donnée pour facture, le conseil de retirer ou de redater ;
--   - vingt-deux mutations du cœur : toute date figée dite « validée », le chef remplacé par un membre assigné,
--     l'anonyme admis, un exercice en cours, un mouvement à traiter, un exercice sauté, des écritures antérieures, la
--     2035, l'équilibre, la couverture de la numérotation, une seconde validation, le super-administrateur qui insère
--     partout, l'empreinte sensible à l'échelle ou aveugle aux à-nouveaux, la vérification qui ignore le maillon, une
--     pièce figée tout entière, la banque qui ne réimporte plus, l'échéance datée à son échéance, la date de mise à
--     jour du cadre 7 comptée comme un changement, un déclencheur désactivé, la cascade qui ne passe plus, l'ouverture
--     qui se remplace ;
--   - quatre mutations du harnais : sans changement de rôle (les quatre contrôles qui dépendent de la RLS
--     tombent), sans annulation de chaque contrôle (vingt-cinq tombent), sans annulation finale (le dernier
--     tombe), et sans le message des refus : la mutation « toute date figée se dit validée » ne fait alors plus
--     tomber que le contrôle qui compare lui-même ses messages, au lieu de sept — c'est le message qui la voit.
-- Une mutation a d'abord SURVÉCU, et c'est l'essai qu'elle accusait : la « sauvegarde » d'une ligne du cadre 7
-- posait `updated_at = now()`, or `now()` vaut l'heure du début de la transaction, celle de l'insertion de la
-- ligne — elle ne changeait rien. Elle décale désormais la date d'une seconde.
-- La lecture de la cascade (141) part de TOUS les déclencheurs posés avant une suppression, lus du catalogue (22 au
-- 09/10/2026), et dit de chacun comment il laisse passer la cascade d'un dossier qu'on supprime : `dossier` — sa
-- fonction porte la condition `not exists (select 1 from public.dossiers where id = old.dossier_id)`, lue blancs
-- ramenés à un seul et alias de table permis ; `parent:<table>` — sa table n'a pas de `dossier_id` et part avec son
-- parent par une clé en cascade, que la garde relit (les lignes d'une facture : leur facture déjà partie, plus rien
-- ne les dit validées) ; `?` sinon. Un déclencheur nouveau, désactivé, ou qui perd sa condition la fait tomber. Elle
-- partait des fonctions `garder%` qui portaient la condition à la lettre, et neuf déclencheurs sur vingt-deux lui
-- échappaient sans qu'elle tombe : les quatre de la révision des soldes (trois fonctions) et ceux des encaissements,
-- de leurs parts par taux, de leurs déclarations et des statuts reçus, qui écrivent la condition avec un alias — et
-- celui des lignes d'une facture, qui ne l'écrit pas. Elle reste une LECTURE : une suppression ne se joue pas en
-- production (l'outil la soumet à une confirmation qui n'arrive pas) : celle d'un dossier entier ne se joue que sur
-- une réplique.
--
-- 24/10/2026 — la migration `jumelle_inversee` APPLIQUÉE en production (`20261024052424`) : ce fichier n'y a pas été
-- rejoué entier ; la signature des neuf familles en production égale celle de la réplique où il a rendu ses 152 justes
-- (HISTORIQUE.md, « LE VIREMENT MIXTE ET LA JUMELLE INVERSÉE EN PRODUCTION »).
--
-- ADAPTÉ LE 29/10/2026 À LA CAISSE (ligne 26.6, étape C1 ; migration `caisse`, PRÉPARÉE dans `supabase/preparees/`,
-- pas encore en base) : elle pose deux gardes qui veillent sur la suppression, `garder_operation_caisse` et
-- `garder_ecriture_de_caisse`, toutes deux de la forme `dossier`. La lecture de la cascade (141) part de tous les
-- déclencheurs, ces deux-là écartés, et attend ses 43 ; 141b lit les deux : aucun sans la migration, actifs et de la
-- forme `dossier` avec elle. Avant la migration, rien ne change.
--
-- ÉTENDU LE 31/10/2026 AUX QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE (ligne 26.6, étape e ; lot FEC22b ; migration
-- `champs_bnc_du_fec`, PRÉPARÉE dans `supabase/preparees/`, pas encore en base). Une étape de genre « …f » ne se joue
-- qu'avec elle — ses colonnes sur `ecritures_brouillon` — : sans elle, une ligne dit qu'elles attendent (EN ATTENTE), et
-- les 145 contrôles d'hier rendent ce qu'ils rendaient. Avec elle, ces 145 contrôles sont LE CAS NEUTRE : une
-- numérotation qui ne porte pas les clés valide comme hier, refus et écritures compris, et 172 relit que les écritures de
-- A n'en portent aucune. Puis, sur deux dossiers jetables de plus — K, tenu en trésorerie, une écriture de chaque forme
-- (un achat et une vente payés par le relevé, une recette affectée, une dotation sous l'option « vides » de FEC22-Q1) et
-- six documents aux SIRET FICTIFS (préfixe 999), ceux de La Poste validés chacun dans l'étape qui le juge ; RF, sans
-- exercice validé, pour la restauration — : chaque refus neuf de la validation, dans son ordre et sous ses mots (151 à
-- 165, deux défauts à la fois compris, un défaut d'hier l'emportant sur un champ neuf), les débours et les honoraires
-- rétrocédés refusés sur un produit et admis sur une charge (158c à 158f) ; ce qui passe (152b, le jour même à Paris ;
-- 162c, deux écritures d'un même journal ; 164, le numéro d'une facture validée, un SIREN saisi seul, La Poste et son
-- siège ; un avoir) ; une ligne scindée entre deux écritures, que le refus d'hier écarte (166) ; la validation qui les
-- porte, et les fige, relus ligne à ligne (170, 171) ; l'intangibilité (174) ; l'empreinte qui les compte (173 à 176 :
-- chaque colonne falsifiée hors déclencheur, l'une après l'autre, se voit, une valeur passée d'une colonne à l'autre
-- aussi, et l'empreinte d'un exercice validé sans eux est celle d'hier au caractère près, recalculée ici par la formule
-- d'hier) ; la contrainte, sans la fonction (180 à 183, la restauration comprise) ; le catalogue (190). Les factures de
-- l'essai entrent au décompte de 145.
--
-- 01/11/2026, LES QUATRE POSTES NEUFS DE LA 2035 (étape 2035S1 : « Indemnités journalières », rangées en AF ; « Redevances
-- de collaboration », en BG ; « Cotisations facultatives Madelin » et « Plan d'épargne retraite », en BK), entrés dans les
-- listes fermées de `champs_bnc_du_fec` et du filet qui reprend sa validation (`validation_des_paiements_par_la_caisse`) :
-- chacun admis à sa place et refusé de l'autre côté, par la validation (158g à 158n) et par la restauration (182i à 182p).
-- Sur la réplique de FEC22b, la migration d'avant — sans eux — fait tomber les douze étapes qui les distinguent, et elles
-- seules (245 verdicts) ; l'amendée les rend toutes justes, 245 sur 245, et les 229 contrôles d'hier gardent leurs verdicts
-- au caractère près.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid; categorie uuid;
  annee_courante int := extract(year from (now() at time zone 'Europe/Paris'))::int;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
  -- La migration du lot FEC22b : ses colonnes sur le brouillon. Sans elle, ses étapes (genre « …f ») attendent.
  fec boolean := exists (select 1 from pg_attribute where attrelid = 'public.ecritures_brouillon'::regclass
                          and attname = 'nature_operation' and not attisdropped);
  genre text; en_attente_fec integer := 0;
  -- L'empreinte d'un exercice validé telle que `report_des_soldes` l'écrivait (sans les quatre champs), le dossier, l'année
  -- et l'empreinte précédente à poser par `format` : 173c la confronte à celle d'aujourd'hui.
  empreinte_d_hier text := $f$encode(sha256(convert_to(
    coalesce(%3$L, '') || chr(29)
    || coalesce((
      select string_agg(concat_ws(chr(31),
          e.id::text, to_char(e.date, 'YYYY-MM-DD'), e.journal_code, e.numero_ecriture::text, e.compte, e.compte_lib,
          coalesce(e.comp_aux_num, ''), coalesce(e.comp_aux_lib, ''), e.piece_ref, to_char(e.piece_date, 'YYYY-MM-DD'),
          e.libelle, trim_scale(e.montant)::text, e.sens,
          to_char(e.valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')),
        chr(30) order by e.journal_code, e.numero_ecriture, e.id)
      from public.ecritures_brouillon e
      where e.dossier_id = '%1$s' and e.statut = 'validee'
        and e.date between make_date(%2$s, 1, 1) and make_date(%2$s, 12, 31)), '')
    || chr(29)
    || coalesce((
      select string_agg(concat_ws(chr(31),
          a.id::text, to_char(a.date, 'YYYY-MM-DD'), a.compte, coalesce(a.compte_origine, ''), a.libelle, a.sens,
          trim_scale(a.montant)::text, a.source_nom, a.source_empreinte, coalesce(a.compte_lib, ''),
          coalesce(a.ecriture_lib, '')),
        chr(30) order by a.compte, a.id)
      from (
        select n.id, n.date, n.compte, n.compte_origine, n.libelle, n.sens, n.montant, n.source_nom, n.source_empreinte,
               n.compte_lib, n.ecriture_lib
          from public.a_nouveaux n
         where n.dossier_id = '%1$s' and n.date between make_date(%2$s, 1, 1) and make_date(%2$s, 12, 31)
        union all
        select s.id, s.date, s.compte, null::text, s.libelle, s.sens, s.montant, s.source_nom, s.source_empreinte,
               s.compte_lib, s.ecriture_lib
          from public.soldes_reportes s
         where s.dossier_id = '%1$s' and s.date = make_date(%2$s, 1, 1)
      ) a), ''),
    'UTF8')), 'hex')$f$;
  -- Le jour à Paris, tel que la validation le lit : 152 pose une date de règlement deux jours après, 152b ce jour même.
  aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  select id into categorie from categories where dossier_id is null order by code limit 1;
  if dossier_client is null or cabinet is null or categorie is null or dossier_client = dossier_test
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'CAT', categorie, 'DC', dossier_client, 'CHEF', chef, 'CLIENT', client)
    || jsonb_build_object(
      'A', 'e55a1000-0000-4000-8000-0000000000a1', 'X', 'e55a1000-0000-4000-8000-0000000000a2',
      'F', 'e55a1000-0000-4000-8000-0000000000a3', 'G', 'e55a1000-0000-4000-8000-0000000000a4',
      'H', 'e55a1000-0000-4000-8000-0000000000a5', 'J1', 'e55a1000-0000-4000-8000-0000000000a6',
      'R', 'e55a1000-0000-4000-8000-0000000000a7', 'CJ', 'e55a1000-0000-4000-8000-0000000000c1',
      'P1', 'e55a1000-0000-4000-8001-000000000001', 'P2', 'e55a1000-0000-4000-8001-000000000002',
      'P3', 'e55a1000-0000-4000-8001-000000000003', 'P4', 'e55a1000-0000-4000-8001-000000000004')
    || jsonb_build_object(
      'M1', 'e55a1000-0000-4000-8002-000000000001', 'M2', 'e55a1000-0000-4000-8002-000000000002',
      'M3', 'e55a1000-0000-4000-8002-000000000003', 'M4', 'e55a1000-0000-4000-8002-000000000004',
      'M5', 'e55a1000-0000-4000-8002-000000000005', 'M6', 'e55a1000-0000-4000-8002-000000000006',
      'M7', 'e55a1000-0000-4000-8002-000000000007', 'M8', 'e55a1000-0000-4000-8002-000000000008',
      'M9', 'e55a1000-0000-4000-8002-000000000009', 'M10', 'e55a1000-0000-4000-8002-00000000000a',
      'XM24', 'e55a1000-0000-4000-8002-000000000021', 'XM25', 'e55a1000-0000-4000-8002-000000000022',
      'XMV', 'e55a1000-0000-4000-8002-000000000023', 'GM', 'e55a1000-0000-4000-8002-000000000031',
      'RM', 'e55a1000-0000-4000-8002-000000000041')
    || jsonb_build_object(
      'E1', 'e55a1000-0000-4000-8003-000000000001', 'E2', 'e55a1000-0000-4000-8003-000000000002',
      'E3', 'e55a1000-0000-4000-8003-000000000003', 'E4', 'e55a1000-0000-4000-8003-000000000004',
      'E5', 'e55a1000-0000-4000-8003-000000000005', 'E6', 'e55a1000-0000-4000-8003-000000000006',
      'E7', 'e55a1000-0000-4000-8003-000000000007', 'E8', 'e55a1000-0000-4000-8003-000000000008',
      'E9', 'e55a1000-0000-4000-8003-000000000009', 'E10', 'e55a1000-0000-4000-8003-00000000000a',
      'E11', 'e55a1000-0000-4000-8003-00000000000b', 'E12', 'e55a1000-0000-4000-8003-00000000000c',
      'E13', 'e55a1000-0000-4000-8003-00000000000d', 'E14', 'e55a1000-0000-4000-8003-00000000000e',
      'E15', 'e55a1000-0000-4000-8003-00000000000f', 'E16', 'e55a1000-0000-4000-8003-000000000010',
      'E17', 'e55a1000-0000-4000-8003-000000000011', 'XE24', 'e55a1000-0000-4000-8003-000000000021')
    || jsonb_build_object(
      'FE1', 'e55a1000-0000-4000-8003-000000000031', 'FE2', 'e55a1000-0000-4000-8003-000000000032',
      'GE1', 'e55a1000-0000-4000-8003-000000000041', 'GE2', 'e55a1000-0000-4000-8003-000000000042',
      'GE3', 'e55a1000-0000-4000-8003-000000000043', 'GE4', 'e55a1000-0000-4000-8003-000000000044',
      'VP1', 'e55a1000-0000-4000-8004-000000000001', 'VP2', 'e55a1000-0000-4000-8004-000000000002',
      'RG1', 'e55a1000-0000-4000-8004-000000000003', 'XVP', 'e55a1000-0000-4000-8004-000000000021',
      'B1', 'e55a1000-0000-4000-8005-000000000001', 'B2', 'e55a1000-0000-4000-8005-000000000002',
      'B3', 'e55a1000-0000-4000-8005-000000000003', 'XB24', 'e55a1000-0000-4000-8005-000000000021')
    || jsonb_build_object(
      'V1', 'e55a1000-0000-4000-8006-000000000001', 'V2', 'e55a1000-0000-4000-8006-000000000002',
      'XV24', 'e55a1000-0000-4000-8006-000000000021', 'XV25', 'e55a1000-0000-4000-8006-000000000022',
      'C1', 'e55a1000-0000-4000-8007-000000000001', 'C2', 'e55a1000-0000-4000-8007-000000000002',
      'XC24', 'e55a1000-0000-4000-8007-000000000021', 'XAN', 'e55a1000-0000-4000-8008-000000000021',
      'GAN1', 'e55a1000-0000-4000-8008-000000000031', 'GAN2', 'e55a1000-0000-4000-8008-000000000032',
      'HAN1', 'e55a1000-0000-4000-8008-000000000041', 'HAN2', 'e55a1000-0000-4000-8008-000000000042')
    -- Le lot FEC22b : K, RF et leurs lignes ; et des fragments de requête, sans accolade à remplacer.
    || jsonb_build_object(
      'K', 'e55a1000-0000-4000-80f0-0000000000a1', 'RF', 'e55a1000-0000-4000-80f0-0000000000a2',
      'PK1', 'e55a1000-0000-4000-80f1-000000000001', 'PK2', 'e55a1000-0000-4000-80f1-000000000002',
      'MK1', 'e55a1000-0000-4000-80f2-000000000001', 'MK2', 'e55a1000-0000-4000-80f2-000000000002',
      'MK3', 'e55a1000-0000-4000-80f2-000000000003', 'BK', 'e55a1000-0000-4000-80f3-000000000001',
      'EK1', 'e55a1000-0000-4000-80f4-000000000001', 'EK2', 'e55a1000-0000-4000-80f4-000000000002',
      'EK3', 'e55a1000-0000-4000-80f4-000000000003', 'EK4', 'e55a1000-0000-4000-80f4-000000000004',
      'EK5', 'e55a1000-0000-4000-80f4-000000000005', 'EK6', 'e55a1000-0000-4000-80f4-000000000006',
      'EK7', 'e55a1000-0000-4000-80f4-000000000007', 'EK8', 'e55a1000-0000-4000-80f4-000000000008',
      'RF1', 'e55a1000-0000-4000-80f5-000000000001', 'RF2', 'e55a1000-0000-4000-80f5-000000000002')
    || jsonb_build_object(
      'VAL', 'select valider_exercice(', 'FIN', ', ''[]''::jsonb, ''{}''::jsonb)', 'JK', 'current_setting(''essai.k'')::jsonb',
      'ENF', 'select enregistrer_facture(',
      'FK', '''{"tiers_nom":"ESSAI","emetteur_nom":"ESSAI","montant_ht":100,"montant_tva":20,"montant_ttc":120,"nature_operation":"services"}''::jsonb',
      'LK', '''[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]''::jsonb',
      -- Une écriture validée réinsérée par la restauration dans RF, ses champs à compléter (183 à 187).
      'RES', 'insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib, date_reglement, mode_reglement, nature_operation, poste_rattache, identification_client) values (');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from pieces)), ((select count(*) from lignes_bancaires)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from immobilisations)), ((select count(*) from vehicules)), ((select count(*) from cotisations_declarees)),
    ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)), ((select count(*) from dossier_assignations)),
    ((select count(*) from soldes_reportes)), ((select count(*) from factures_emises))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  --   jeu     : posée par le propriétaire de la base, gardée ; un échec est une faute de l'essai lui-même ;
  --   controle: jouée sous « qui », puis annulée ; « OK » attend qu'elle passe ;
  --   fait    : jouée sous « qui » et GARDÉE jusqu'à l'annulation finale (une validation dont la suite a besoin) ;
  --   valeur  : une lecture par le propriétaire, qui doit rendre exactement la valeur attendue.
  etapes := array[
    -- ══ Le jeu : des dossiers jetables, dans le cabinet du dossier test et dans un cabinet jetable ═════════════════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable) values
      ('{A}', 'ESSAI VALIDATION A', '{CAB}', 'tresorerie'), ('{X}', 'ESSAI VALIDATION X', '{CAB}', 'tresorerie'),
      ('{F}', 'ESSAI VALIDATION F', '{CAB}', 'engagement'), ('{G}', 'ESSAI VALIDATION G', '{CAB}', 'tresorerie'),
      ('{H}', 'ESSAI VALIDATION H', '{CAB}', 'tresorerie'), ('{R}', 'ESSAI VALIDATION R', '{CAB}', 'tresorerie')$q$, '', ''],
    array['jeu', 'cabinet jetable', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI VALIDATION CABINET')$q$, '', ''],
    array['jeu', 'son dossier', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI VALIDATION J1', '{CJ}')$q$, '', ''],
    array['jeu', 'pièces de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece) values
      ('{P1}', '{A}', 'essai/validation/p1.pdf', 'essai-p1.pdf', 'validee', 'achat', 100, '2024-03-01'),
      ('{P2}', '{A}', 'essai/validation/p2.pdf', 'essai-p2.pdf', 'validee', 'achat', 30, '2025-02-01'),
      ('{P3}', '{A}', 'essai/validation/p3.pdf', 'essai-p3.pdf', 'validee', 'achat', 40, '2024-05-01'),
      ('{P4}', '{A}', 'essai/validation/p4.pdf', 'essai-p4.pdf', 'validee', 'achat', 1200, '2023-06-01')$q$, '', ''],
    array['jeu', 'échéances de A', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values
      ('{C1}', '{A}', '2024-03-01', 80), ('{C2}', '{A}', '2024-12-15', 80)$q$, '', ''],
    array['jeu', 'mouvements de A', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, categorie_id, ventilee, reglement_groupe, cotisation_id, id_externe) values
      ('{M1}', '{A}', '2024-03-05', 'ESSAI PRLV P1', -100, 'rapprochee', '{P1}', null, false, false, null, null),
      ('{M2}', '{A}', '2024-04-10', 'ESSAI VIR CPAM', 50, 'rapprochee', null, '{CAT}', false, false, null, null),
      ('{M3}', '{A}', '2024-04-20', 'ESSAI CB VENTILEE', -60, 'rapprochee', null, null, true, false, null, null),
      ('{M4}', '{A}', '2024-05-10', 'ESSAI VIR GROUPE', -40, 'rapprochee', null, null, false, true, null, null),
      ('{M5}', '{A}', '2024-03-01', 'ESSAI URSSAF', -80, 'rapprochee', null, null, false, false, '{C1}', null),
      ('{M6}', '{A}', '2025-01-05', 'ESSAI URSSAF', -80, 'rapprochee', null, null, false, false, '{C2}', null),
      ('{M7}', '{A}', '2025-02-01', 'ESSAI PRLV P2', -30, 'non_rapprochee', null, null, false, false, null, null),
      ('{M8}', '{A}', '2024-06-15', 'ESSAI FRAIS', -2, 'ignoree', null, null, false, false, null, 'ESSAI-EXT-1'),
      ('{M9}', '{A}', '2024-06-01', 'ESSAI A TRAITER', -7, 'non_rapprochee', null, null, false, false, null, null),
      ('{M10}', '{A}', '2026-01-15', 'ESSAI PLUS TARD', -9, 'non_rapprochee', null, null, false, false, null, null)$q$, '', ''],
    array['jeu', 'ventilation de A', 'postgres', $q$insert into ventilations_bancaires (id, dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant) values
      ('{VP1}', '{A}', '{M3}', '{CAT}', false, -42), ('{VP2}', '{A}', '{M3}', null, true, -18)$q$, '', ''],
    array['jeu', 'règlement groupé de A', 'postgres', $q$insert into reglements_groupes (id, dossier_id, ligne_bancaire_id, piece_id, montant) values ('{RG1}', '{A}', '{M4}', '{P3}', -40)$q$, '', ''],
    array['jeu', 'biens de A', 'postgres', $q$insert into immobilisations (id, dossier_id, piece_id, libelle, valeur, date_acquisition, duree_annees) values
      ('{B1}', '{A}', '{P4}', 'ESSAI Ordinateur', 1200, '2023-06-01', 3), ('{B2}', '{A}', null, 'ESSAI Bien de 2025', 900, '2025-09-01', 3),
      ('{B3}', '{A}', null, 'ESSAI Bien sans écriture', 300, '2024-02-01', 3)$q$, '', ''],
    array['jeu', 'cadre 7 de A', 'postgres', $q$insert into vehicules (id, dossier_id, annee, modele, km_professionnel, puissance_fiscale) values
      ('{V1}', '{A}', 2024, 'VÉHICULE ESSAI 2024', 1000, 5), ('{V2}', '{A}', 2025, 'VÉHICULE ESSAI 2025', 900, 5)$q$, '', ''],
    array['jeu', 'écritures de A', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id, date, compte, libelle, montant, sens) values
      ('{E1}', '{A}', '{P1}', null, null, null, '2024-03-05', '606100', 'ESSAI P1', 100, 'debit'),
      ('{E2}', '{A}', '{P1}', '{M1}', null, null, '2024-03-05', '512000', 'ESSAI P1', 100, 'credit'),
      ('{E3}', '{A}', null, '{M2}', null, null, '2024-04-10', '706000', 'ESSAI CPAM', 50, 'credit'),
      ('{E4}', '{A}', null, '{M2}', null, null, '2024-04-10', '512000', 'ESSAI CPAM', 50, 'debit'),
      ('{E5}', '{A}', null, '{M3}', null, null, '2024-04-20', '606100', 'ESSAI VENTILEE', 42, 'debit'),
      ('{E6}', '{A}', null, '{M3}', null, null, '2024-04-20', '108000', 'ESSAI VENTILEE', 18, 'debit'),
      ('{E7}', '{A}', null, '{M3}', null, null, '2024-04-20', '512000', 'ESSAI VENTILEE', 60, 'credit'),
      ('{E8}', '{A}', '{P3}', null, null, null, '2024-05-10', '606100', 'ESSAI P3', 40, 'debit'),
      ('{E9}', '{A}', '{P3}', '{M4}', null, null, '2024-05-10', '512000', 'ESSAI P3', 40, 'credit'),
      ('{E10}', '{A}', null, '{M5}', null, null, '2024-03-01', '646000', 'ESSAI URSSAF', 80, 'debit'),
      ('{E11}', '{A}', null, '{M5}', null, null, '2024-03-01', '512000', 'ESSAI URSSAF', 80, 'credit'),
      ('{E12}', '{A}', null, null, '{B1}', null, '2024-12-31', '681100', 'ESSAI DOTATION', 400, 'debit'),
      ('{E13}', '{A}', null, null, '{B1}', null, '2024-12-31', '281830', 'ESSAI DOTATION', 400, 'credit'),
      ('{E14}', '{A}', null, null, null, '{V1}', '2024-12-31', '625110', 'ESSAI FORFAIT', 529, 'debit'),
      ('{E15}', '{A}', null, null, null, '{V1}', '2024-12-31', '108000', 'ESSAI FORFAIT', 529, 'credit'),
      ('{E16}', '{A}', '{P2}', null, null, null, '2025-02-01', '606100', 'ESSAI P2', 30, 'debit'),
      ('{E17}', '{A}', '{P2}', null, null, null, '2025-02-01', '512000', 'ESSAI P2', 30, 'credit')$q$, '', ''],
    -- La numérotation juste de 2024, celle que l'application composerait : un numéro par écriture, de 1 dans
    -- l'ordre des dates de chaque journal. Ses variantes fautives en dérivent, par leur rang dans cette liste.
    array['jeu', 'numérotation de 2024', 'postgres', $q$select set_config('essai.juste', $j$[
      {"id":"{E1}","journal":"AC","numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01","compte_lib":"Achats"},
      {"id":"{E2}","journal":"AC","numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01","compte_lib":"Banque"},
      {"id":"{E8}","journal":"AC","numero":2,"piece_ref":"essai-p3.pdf","piece_date":"2024-05-01","compte_lib":"Achats"},
      {"id":"{E9}","journal":"AC","numero":2,"piece_ref":"essai-p3.pdf","piece_date":"2024-05-01","compte_lib":"Banque"},
      {"id":"{E10}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Cotisations"},
      {"id":"{E11}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Banque"},
      {"id":"{E3}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-04-10","compte_lib":"Honoraires"},
      {"id":"{E4}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-04-10","compte_lib":"Banque"},
      {"id":"{E5}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-20","compte_lib":"Achats"},
      {"id":"{E6}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-20","compte_lib":"Exploitant"},
      {"id":"{E7}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-20","compte_lib":"Banque"},
      {"id":"{E12}","journal":"OD","numero":1,"piece_ref":"Tableau d'amortissement 2024","piece_date":"2024-12-31","compte_lib":"Dotations"},
      {"id":"{E13}","journal":"OD","numero":1,"piece_ref":"Tableau d'amortissement 2024","piece_date":"2024-12-31","compte_lib":"Amortissements"},
      {"id":"{E14}","journal":"OD","numero":2,"piece_ref":"Barème kilométrique 2024","piece_date":"2024-12-31","compte_lib":"Indemnités kilométriques"},
      {"id":"{E15}","journal":"OD","numero":2,"piece_ref":"Barème kilométrique 2024","piece_date":"2024-12-31","compte_lib":"Exploitant"}
    ]$j$, true)$q$, '', ''],
    array['jeu', 'mouvements de X', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, ventilee) values
      ('{XM24}', '{X}', '2024-02-02', 'ESSAI X 2024', -12, 'non_rapprochee', false), ('{XM25}', '{X}', '2025-02-02', 'ESSAI X 2025', -13, 'non_rapprochee', false),
      ('{XMV}', '{X}', '2024-02-03', 'ESSAI X VENTILEE', -20, 'rapprochee', true)$q$, '', ''],
    array['jeu', 'part de X', 'postgres', $q$insert into ventilations_bancaires (id, dossier_id, ligne_bancaire_id, categorie_id, montant) values ('{XVP}', '{X}', '{XMV}', '{CAT}', -20)$q$, '', ''],
    array['jeu', 'bien de X', 'postgres', $q$insert into immobilisations (id, dossier_id, libelle, valeur, date_acquisition) values ('{XB24}', '{X}', 'ESSAI X bien', 900, '2024-04-01')$q$, '', ''],
    array['jeu', 'cadre 7 de X', 'postgres', $q$insert into vehicules (id, dossier_id, annee, modele, km_professionnel) values
      ('{XV24}', '{X}', 2024, 'VÉHICULE ESSAI X 2024', 10), ('{XV25}', '{X}', 2025, 'VÉHICULE ESSAI X 2025', 10)$q$, '', ''],
    array['jeu', 'échéance de X', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values ('{XC24}', '{X}', '2024-06-01', 40)$q$, '', ''],
    array['jeu', 'à-nouveau de X', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{XAN}', '{X}', '2024-01-01', '512000', 'debit', 1, 'balance-essai-x.csv', repeat('d', 64))$q$, '', ''],
    array['jeu', 'écriture de X', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values ('{XE24}', '{X}', '2024-07-01', '606100', 'ESSAI X', 1, 'debit')$q$, '', ''],

    -- ══ Qui peut valider ═══════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'permission denied%'],
    array['controle', '2. rattaché à rien', 'inconnu', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select valider_exercice('{DC}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['jeu', 'le client devient membre du cabinet jetable, assigné à son dossier', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossier_assignations (dossier_id, user_id) values ('{J1}', '{CLIENT}')$q$, '', ''],
    array['controle', '5. membre du cabinet, assigné au dossier', 'client', $q$select valider_exercice('{J1}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['jeu', 'le client devient chef du cabinet jetable', 'postgres', $q$update cabinet_admins set role = 'comptable_en_chef' where user_id = '{CLIENT}' and cabinet_id = '{CJ}'$q$, '', ''],
    array['controle', '6. chef d''un autre cabinet', 'client', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['controle', '7. dossier inexistant', 'chef', $q$select valider_exercice(gen_random_uuid(), 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['fait', '8. un chef de cabinet qui n''est pas super-administrateur valide un dossier de son cabinet', 'client', $q$select valider_exercice('{J1}', 2024, '[]'::jsonb, '[]'::jsonb, '{"essai":"J1"}'::jsonb)$q$, 'OK', ''],
    array['valeur', '9. la validation porte le nom de qui l''a faite', 'postgres', $q$select (valide_par = '{CLIENT}')::text || '/' || nb_lignes || '/' || (declaration->>'essai') from exercices_valides where dossier_id = '{J1}'$q$, '', 'true/0/J1'],

    -- ══ Ce qui se refuse, avec sa raison ═══════════════════════════════════════════════════════════════════════════
    array['controle', '10. exercice invalide', 'chef', $q$select valider_exercice('{A}', 1999, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Exercice invalide.'],
    array['controle', '11. exercice en cours', 'chef', format($q$select valider_exercice('{A}', %s, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, annee_courante), '22023', format('L''exercice %s n''est pas terminé : il se valide une fois clos.', annee_courante)],
    array['controle', '12. un mouvement de 2024 reste à traiter', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 porte des mouvements bancaires à traiter : ils se traitent avant la validation.'],
    array['jeu', 'le mouvement à traiter est ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{M9}'$q$, '', ''],
    array['controle', '13. la 2035 manque', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, null)$q$, '22023', 'La 2035 à valider manque.'],
    array['controle', '14. la 2035 n''est pas un objet', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, '22023', 'La 2035 à valider manque.'],
    array['controle', '15. numérotation illisible', 'chef', $q$select valider_exercice('{A}', 2024, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée est illisible.'],
    array['controle', '16. libellés des à-nouveaux illisibles', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, null, '{}'::jsonb)$q$, '22023', 'Les libellés proposés des à-nouveaux sont illisibles.'],
    array['controle', '17. une ligne manque', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb - 14, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée ne couvre pas exactement les 15 écritures de l''exercice 2024.'],
    array['controle', '18. une ligne d''un autre exercice', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb || '[{"id":"{E16}","journal":"AC","numero":3,"piece_ref":"x","piece_date":"2025-02-01","compte_lib":"Achats"}]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée ne couvre pas exactement les 15 écritures de l''exercice 2024.'],
    array['controle', '19. une ligne en double', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb || jsonb_build_array(current_setting('essai.juste')::jsonb -> 0), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée ne couvre pas exactement les 15 écritures de l''exercice 2024.'],
    array['controle', '20. un journal inconnu', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0,journal}', '"XX"'), '{1,journal}', '"XX"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une ligne de la numérotation proposée est incomplète.'],
    array['controle', '21. des numéros qui sautent', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0,numero}', '3'), '{1,numero}', '3'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les numéros d''un journal ne se suivent pas.'],
    array['controle', '22. des numéros à rebours des dates', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0,numero}', '2'), '{1,numero}', '2'), '{2,numero}', '1'), '{3,numero}', '1'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les numéros d''un journal ne suivent pas l''ordre des dates.'],
    array['controle', '23. une écriture déséquilibrée', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{1,numero}', '2'), '{2,numero}', '3'), '{3,numero}', '3'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une écriture n''est pas équilibrée au centime.'],
    array['controle', '24. deux pièces dans une écriture', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{1,piece_ref}', '"autre"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les lignes d''une même écriture ne portent pas la même pièce.'],
    -- La pièce P3 rangée sous le numéro de P1, avec sa référence et sa date de pièce : équilibrée, une seule pièce,
    -- mais ses lignes du 10 mai sous l'écriture du 5 mars. C'est la forme qu'avait une pièce payée en deux fois avant
    -- le 05/10/2026, et l'outil de la DGFiP la range parmi ses anomalies (« Différentes dates comptables »).
    array['controle', '24b. deux dates dans une écriture', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{2}', (current_setting('essai.juste')::jsonb -> 2) || '{"numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01"}'), '{3}', (current_setting('essai.juste')::jsonb -> 3) || '{"numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01"}'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les lignes d''une même écriture ne portent pas la même date.'],
    array['controle', '25. deux libellés pour un compte', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{7,compte_lib}', '"Compte bancaire"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un même compte porte deux libellés.'],
    array['controle', '26. un compte auxiliaire sans libellé', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{0,comp_aux_num}', '"FESSAI"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une ligne de la numérotation proposée est incomplète.'],
    array['controle', '27. deux libellés pour un compte auxiliaire', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0}', (current_setting('essai.juste')::jsonb -> 0) || '{"comp_aux_num":"FESSAI","comp_aux_lib":"Essai"}'), '{2}', (current_setting('essai.juste')::jsonb -> 2) || '{"comp_aux_num":"FESSAI","comp_aux_lib":"Autre"}'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un même compte auxiliaire porte deux libellés.'],
    array['controle', '28. une pièce sans date', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{4}', (current_setting('essai.juste')::jsonb -> 4) - 'piece_date'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une ligne de la numérotation proposée est incomplète.'],
    array['controle', '29. une écriture validée à la main', 'chef', $q$update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'AC', numero_ecriture = 1, piece_ref = 'x', piece_date = '2024-03-01', compte_lib = 'x' where id = '{E1}'$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['controle', '30. ni celle d''un exercice qu''on ne valide pas, par le super-administrateur', 'chef', $q$update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'OD', numero_ecriture = 9, piece_ref = 'x', piece_date = '2025-02-01', compte_lib = 'x' where id = '{E16}'$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['valeur', '31. rien n''est validé après les refus', 'postgres', $q$select (select count(*) from ecritures_brouillon where dossier_id = '{A}' and statut = 'validee') || '/' || (select count(*) from exercices_valides where dossier_id = '{A}')$q$, '', '0/0'],

    -- ══ Le contrôle POSITIF : le chef valide 2024 ══════════════════════════════════════════════════════════════════
    array['fait', '32. le chef valide 2024', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '{"essai":"oui"}'::jsonb)$q$, 'OK', ''],
    array['valeur', '33. les écritures de 2024 sont figées et numérotées, avec le libellé de leur compte', 'postgres', $q$select string_agg(journal_code || numero_ecriture || ':' || compte || ':' || compte_lib, ',' order by journal_code collate "C", numero_ecriture, compte collate "C") from ecritures_brouillon where dossier_id = '{A}' and statut = 'validee'$q$, '',
      'AC1:512000:Banque,AC1:606100:Achats,AC2:512000:Banque,AC2:606100:Achats,BQ1:512000:Banque,BQ1:646000:Cotisations,BQ2:512000:Banque,BQ2:706000:Honoraires,BQ3:108000:Exploitant,BQ3:512000:Banque,BQ3:606100:Achats,OD1:281830:Amortissements,OD1:681100:Dotations,OD2:108000:Exploitant,OD2:625110:Indemnités kilométriques'],
    array['valeur', '34. une écriture validée porte sa pièce', 'postgres', $q$select piece_ref || ' ' || piece_date || ' ' || (comp_aux_num is null) from ecritures_brouillon where id = '{E13}'$q$, '', 'Tableau d''amortissement 2024 2024-12-31 true'],
    array['valeur', '35. l''exercice est enregistré : lignes, écritures, totaux, 2035, premier maillon, auteur, date', 'postgres', $q$select nb_lignes || '/' || nb_ecritures || '/' || total_debit || '/' || total_credit || '/' || mode_comptable || '/' || (declaration->>'essai') || '/' || (empreinte_precedente is null) || '/' || (valide_par = '{CHEF}') || '/' || (valide_le = (select max(valide_le) from ecritures_brouillon where dossier_id = '{A}')) from exercices_valides where dossier_id = '{A}'$q$, '', '15/7/1259.00/1259.00/tresorerie/oui/true/true/true'],
    array['valeur', '36. rien de 2025 n''est validé', 'postgres', $q$select count(*) filter (where statut = 'proposee') || '/' || count(*) from ecritures_brouillon where dossier_id = '{A}' and date >= '2025-01-01'$q$, '', '2/2'],
    -- Les soldes de fin de 2024 : la banque et l'amortissement sous leur numéro et leur libellé figé ; le 108 (18 − 529)
    -- et le résultat (une perte de 1 141) au capital individuel, A étant tenu en trésorerie. Sans libellé de compte tant
    -- que 2025 n'est pas validé, et chacun porte l'empreinte de 2024.
    array['valeur', '36b. la validation écrit l''ouverture de 2025 : les soldes de fin de 2024', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(source_nom) || '/' || bool_and(source_empreinte = (select empreinte from exercices_valides where dossier_id = '{A}' and annee = 2024)) || '/' || min(date) || '/' || count(compte_lib) from soldes_reportes where dossier_id = '{A}'$q$, '',
      '101000:debit:630.00:Capital individuel,281830:credit:400.00:Amortissements,512000:credit:230.00:Banque/Exercice 2024 validé/true/2025-01-01/0'],
    array['controle', '37. le chef vérifie l''empreinte', 'chef', $q$do $x$ begin if not verifier_exercice_valide('{A}', 2024) then raise exception 'EMPREINTE FAUSSE'; end if; end $x$$q$, 'OK', ''],
    array['controle', '38. le client ne lit ni la validation ni les écritures d''un autre', 'client', $q$do $x$ begin if verifier_exercice_valide('{A}', 2024) is not null or exists (select 1 from exercices_valides where dossier_id = '{A}') or exists (select 1 from ecritures_brouillon where dossier_id = '{A}') then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '39. l''anonyme ne vérifie rien', 'anon', $q$select verifier_exercice_valide('{A}', 2024)$q$, '42501', 'permission denied%'],
    array['controle', '40. valider 2024 une seconde fois', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 est déjà validé, ou un exercice postérieur l''est.'],
    array['controle', '41. ni un exercice antérieur', 'chef', $q$select valider_exercice('{A}', 2023, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2023 est déjà validé, ou un exercice postérieur l''est.'],

    -- ══ L'intangibilité ════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '42. modifier une écriture validée', 'chef', $q$update ecritures_brouillon set libelle = 'x' where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '43. ni même par une sauvegarde sans changement, à la différence de ses sources', 'chef', $q$update ecritures_brouillon set libelle = libelle where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '44. ni le propriétaire de la base', 'postgres', $q$update ecritures_brouillon set montant = 99 where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '45. passer une écriture dans 2024', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{A}', '2024-12-31', '606100', 'ESSAI TARD', 1, 'debit')$q$, '23514', 'L''exercice 2024 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '46. ni avant le premier exercice validé, sans le dire validé', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{A}', '2023-06-01', '606100', 'ESSAI TARD', 1, 'debit')$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : aucune écriture ne s''y passe plus.'],
    array['controle', '47. une écriture de 2025 passe', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{A}', '2025-01-02', '606100', 'ESSAI 2025', 1, 'debit')$q$, 'OK', ''],
    array['controle', '48. reculer une écriture de 2025 dans 2024', 'chef', $q$update ecritures_brouillon set date = '2024-12-31' where id = '{E16}'$q$, '23514', 'L''exercice 2024 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '49. le super-administrateur n''insère pas d''écriture validée dans un dossier qui a un exercice validé', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values ('{A}', '2025-03-01', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'OD', 9, 'x', '2025-03-01', 'Achats')$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['controle', '50. une écriture de 2024 venue d''un autre dossier', 'chef', $q$update ecritures_brouillon set dossier_id = '{A}' where id = '{XE24}'$q$, '23514', 'L''exercice 2024 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '51. une écriture validée ne quitte pas son dossier', 'chef', $q$update ecritures_brouillon set dossier_id = '{X}' where id = '{E3}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '52. l''écriture d''un dossier sans exercice validé reste libre', 'chef', $q$update ecritures_brouillon set libelle = 'ESSAI X modifiée' where id = '{XE24}'$q$, 'OK', ''],
    array['controle', '53. une écriture validée ne reçoit pas une autre pièce', 'chef', $q$update ecritures_brouillon set piece_id = '{P2}' where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],

    -- ══ L'empreinte ════════════════════════════════════════════════════════════════════════════════════════════════
    array['jeu', 'réécrire l''échelle d''un montant hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update ecritures_brouillon set montant = 100.00 where id = '{E1}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '54. une échelle réécrite ne change pas l''empreinte', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text || '/' || (select montant::text from ecritures_brouillon where id = '{E1}')$q$, '', 'true/100.00'],
    array['jeu', 'falsifier un libellé hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update ecritures_brouillon set libelle = 'falsifié' where id = '{E1}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '55. une écriture falsifiée hors déclencheur se voit', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text$q$, '', 'false'],
    array['jeu', 'rétablir le libellé', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update ecritures_brouillon set libelle = 'ESSAI P1' where id = '{E1}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '56. rétablie, elle se relit', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text$q$, '', 'true'],

    -- ══ Les pièces ═════════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '57. le montant d''une pièce dont l''écriture est validée', 'chef', $q$update pieces set montant_ttc = 99 where id = '{P1}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '58. sa catégorie', 'chef', $q$update pieces set categorie_id = '{CAT}' where id = '{P1}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '59. ses notes, son sous-dossier et la confiance de sa lecture restent libres', 'chef', $q$update pieces set notes = 'vu', sous_dossier_id = null, confiance = 'haute', updated_at = now() where id = '{P1}'$q$, 'OK', ''],
    array['controle', '60. une sauvegarde sans changement passe', 'chef', $q$update pieces set montant_ttc = 100.00 where id = '{P1}'$q$, 'OK', ''],
    array['controle', '61. la facture d''un bien amorti en 2024', 'chef', $q$update pieces set montant_ttc = 1100 where id = '{P4}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '62. une pièce figée ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{X}' where id = '{P1}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '63. une pièce de 2025 reste modifiable', 'chef', $q$update pieces set montant_ttc = 31 where id = '{P2}'$q$, 'OK', ''],
    array['controle', '64. une pièce de 2024 déposée après coup', 'chef', $q$insert into pieces (dossier_id, storage_path, nom_fichier, date_piece) values ('{A}', 'essai/validation/tard.pdf', 'essai-tard.pdf', '2024-06-01')$q$, 'OK', ''],

    -- ══ Les mouvements et leurs parts ══════════════════════════════════════════════════════════════════════════════
    array['controle', '65. le statut d''un mouvement de 2024', 'chef', $q$update lignes_bancaires set statut = 'non_rapprochee', piece_id = null where id = '{M1}'$q$, '23514', 'L''exercice 2024 est validé : ce mouvement ne change plus.'],
    array['controle', '66. sa sauvegarde sans changement passe', 'chef', $q$update lignes_bancaires set libelle = libelle where id = '{M1}'$q$, 'OK', ''],
    array['controle', '67. importer un mouvement de 2024', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{A}', '2024-11-02', 'ESSAI TARD', -5)$q$, '23514', 'L''exercice 2024 est validé : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '68. ni un mouvement antérieur au premier exercice validé, sans le dire validé', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{A}', '2023-05-05', 'ESSAI ANCIEN', -5)$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '69. la banque réimporte un mouvement de 2024 qu''elle connaît, et la base l''écarte', 'chef', $q$do $x$ begin insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe) values ('{A}', '2024-06-15', 'ESSAI FRAIS', -2, 'ESSAI-EXT-1') on conflict (dossier_id, id_externe) do nothing; if (select count(*) from lignes_bancaires where dossier_id = '{A}' and date <= '2024-12-31') <> 7 then raise exception 'IMPORTÉ'; end if; end $x$$q$, 'OK', ''],
    array['controle', '70. sans l''écart de la base, ce doublon est refusé par elle', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe) values ('{A}', '2024-06-15', 'ESSAI FRAIS', -2, 'ESSAI-EXT-1')$q$, '23505', '%'],
    array['controle', '71. un mouvement de 2024 que la banque ne connaissait pas', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe) values ('{A}', '2024-06-16', 'ESSAI NOUVEAU', -2, 'ESSAI-EXT-2') on conflict (dossier_id, id_externe) do nothing$q$, '23514', 'L''exercice 2024 est validé : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '72. importer un mouvement de 2025', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{A}', '2025-03-02', 'ESSAI 2025', -5)$q$, 'OK', ''],
    array['controle', '73. reculer un mouvement de 2025 dans 2024', 'chef', $q$update lignes_bancaires set date = '2024-12-30' where id = '{M7}'$q$, '23514', 'L''exercice 2024 est validé : un mouvement ne s''y déplace plus.'],
    array['controle', '74. rapprocher un mouvement de 2025', 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{P2}' where id = '{M7}'$q$, 'OK', ''],
    array['controle', '75. un mouvement de 2024 venu d''un autre dossier', 'chef', $q$update lignes_bancaires set dossier_id = '{A}' where id = '{XM24}'$q$, '23514', 'L''exercice 2024 est validé : un mouvement ne s''y déplace plus.'],
    array['controle', '76. un mouvement de 2025 venu d''un autre dossier', 'chef', $q$update lignes_bancaires set dossier_id = '{A}' where id = '{XM25}'$q$, 'OK', ''],
    array['controle', '77. un mouvement de 2024 ne quitte pas son dossier', 'chef', $q$update lignes_bancaires set dossier_id = '{X}' where id = '{M2}'$q$, '23514', 'L''exercice 2024 est validé : ce mouvement ne change plus.'],
    array['controle', '78. une part d''une ventilation de 2024', 'chef', $q$update ventilations_bancaires set montant = -41 where id = '{VP1}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '79. une part ajoutée à une ventilation de 2024', 'chef', $q$insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, part_personnelle, montant) values ('{A}', '{M3}', true, -1)$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '80. une part d''un règlement groupé de 2024', 'chef', $q$update reglements_groupes set montant = -39 where id = '{RG1}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '81. une part de 2024 venue d''un autre dossier', 'chef', $q$update ventilations_bancaires set dossier_id = '{A}' where id = '{XVP}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '82. une part de 2024 ne quitte pas son dossier', 'chef', $q$update ventilations_bancaires set dossier_id = '{X}' where id = '{VP1}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],

    -- ══ Les biens ══════════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '83. la valeur d''un bien amorti en 2024', 'chef', $q$update immobilisations set valeur = 1100 where id = '{B1}'$q$, '23514', 'Ce bien porte une écriture validée de l''exercice 2024 : sa valeur, ses dates et sa durée ne changent plus.'],
    array['controle', '84. sa sauvegarde sans changement passe', 'chef', $q$update immobilisations set libelle = libelle where id = '{B1}'$q$, 'OK', ''],
    array['controle', '85. ce bien ne quitte pas son dossier', 'chef', $q$update immobilisations set dossier_id = '{X}' where id = '{B1}'$q$, '23514', 'Ce bien porte une écriture validée de l''exercice 2024 : sa valeur, ses dates et sa durée ne changent plus.'],
    array['controle', '86. inscrire un bien acquis en 2024', 'chef', $q$insert into immobilisations (dossier_id, libelle, valeur, date_acquisition) values ('{A}', 'ESSAI Tard', 900, '2024-09-01')$q$, '23514', 'L''exercice 2024 est validé : un bien acquis dans cet exercice ne s''inscrit plus au registre.'],
    array['controle', '87. ni un bien acquis avant le premier exercice validé, sans le dire validé', 'chef', $q$insert into immobilisations (dossier_id, libelle, valeur, date_acquisition) values ('{A}', 'ESSAI Ancien', 900, '2023-01-10')$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : un bien acquis dans cet exercice ne s''inscrit plus au registre.'],
    array['controle', '88. immobiliser une pièce dont l''écriture est validée', 'chef', $q$insert into immobilisations (dossier_id, piece_id, libelle, valeur, date_acquisition) values ('{A}', '{P3}', 'ESSAI Tard', 40, '2025-01-15')$q$, '23514', 'Cette pièce porte une écriture validée : elle ne devient plus une immobilisation.'],
    array['controle', '89. avancer dans 2024 la date d''acquisition d''un bien de 2025', 'chef', $q$update immobilisations set date_acquisition = '2024-12-15' where id = '{B2}'$q$, '23514', 'L''exercice 2024 est validé : la date d''acquisition d''un bien ne s''y porte plus.'],
    array['controle', '90. lui donner pour facture une pièce dont l''écriture est validée', 'chef', $q$update immobilisations set piece_id = '{P3}' where id = '{B2}'$q$, '23514', 'Cette pièce porte une écriture validée : elle ne devient plus une immobilisation.'],
    array['controle', '91. son libellé, et sa date dans 2025, restent libres', 'chef', $q$update immobilisations set libelle = 'ESSAI Bien de 2025 (écran)', date_acquisition = '2025-10-01' where id = '{B2}'$q$, 'OK', ''],
    array['controle', '92. un bien de 2024 sans écriture validée garde son libellé', 'chef', $q$update immobilisations set libelle = 'ESSAI Bien renommé' where id = '{B3}'$q$, 'OK', ''],
    array['controle', '93. un bien de 2024 venu d''un autre dossier', 'chef', $q$update immobilisations set dossier_id = '{A}' where id = '{XB24}'$q$, '23514', 'L''exercice 2024 est validé : la date d''acquisition d''un bien ne s''y porte plus.'],

    -- ══ La restauration : le super-administrateur, dans un dossier sans exercice validé ════════════════════════════
    array['jeu', 'un mouvement à restaurer', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{RM}', '{R}', '2024-03-05', 'ESSAI RESTAURE', -100, 'rapprochee')$q$, '', ''],
    array['fait', '94. la restauration réinsère des écritures déjà validées', 'chef', $q$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('{R}', null, '2024-03-05', '606100', 'ESSAI R', 100, 'debit', 'validee', '2025-02-01 10:00+00', 'BQ', 1, 'Relevé essai', '2024-03-05', 'Achats'),
      ('{R}', '{RM}', '2024-03-05', '512000', 'ESSAI R', 100, 'credit', 'validee', '2025-02-01 10:00+00', 'BQ', 1, 'Relevé essai', '2024-03-05', 'Banque')$q$, 'OK', ''],
    array['controle', '95. le client ne restaure pas d''exercice validé', 'client', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2024, now(), '{CLIENT}', 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb)$q$, '42501', 'new row violates row-level security policy%'],
    array['fait', '96. puis l''exercice validé, en dernier', 'chef', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2024, '2025-02-01 10:00+00', '{CHEF}', 'tresorerie', 2, 1, 100, 100, repeat('c', 64), '{}'::jsonb)$q$, 'OK', ''],
    array['controle', '97. restauré, l''exercice se ferme : plus de mouvement', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{R}', '2024-04-01', 'ESSAI APRES', -1)$q$, '23514', 'L''exercice 2024 est validé : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '98. ni d''écriture validée', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values ('{R}', '2025-06-01', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'OD', 1, 'x', '2025-06-01', 'Achats')$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['jeu', 'une année sautée, que seule une restauration fabriquée produirait', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2026, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('e', 64), '{}'::jsonb)$q$, '', ''],
    array['controle', '99. une année sautée est dite figée, pas validée', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{R}', '2025-04-01', 'ESSAI TROU', -1)$q$, '23514', 'L''exercice 2025 est figé par la validation de l''exercice 2026 : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '100. le refus nomme l''exercice validé qui suit, pas le dernier', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{R}', '2023-04-01', 'ESSAI AVANT', -1)$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : un mouvement de cet exercice ne s''importe plus.'],

    -- ══ Le cadre 7, les échéances et les à-nouveaux ════════════════════════════════════════════════════════════════
    array['controle', '101. le cadre 7 de 2024', 'chef', $q$update vehicules set km_professionnel = 1100 where id = '{V1}'$q$, '23514', 'L''exercice 2024 est validé : son cadre 7 ne change plus.'],
    array['controle', '102. sa sauvegarde sans changement passe, sa date de mise à jour comprise', 'chef', $q$update vehicules set updated_at = updated_at + interval '1 second' where id = '{V1}'$q$, 'OK', ''],
    array['controle', '103. une ligne du cadre 7 ajoutée en 2024', 'chef', $q$insert into vehicules (dossier_id, annee, modele, km_professionnel) values ('{A}', 2024, 'VÉHICULE ESSAI TARD', 10)$q$, '23514', 'L''exercice 2024 est validé : son cadre 7 ne change plus.'],
    array['controle', '104. ni en 2023, sans le dire validé', 'chef', $q$insert into vehicules (dossier_id, annee, modele, km_professionnel) values ('{A}', 2023, 'VÉHICULE ESSAI ANCIEN', 10)$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : son cadre 7 ne change plus.'],
    array['controle', '105. le cadre 7 de 2025 reste modifiable', 'chef', $q$update vehicules set km_professionnel = 950, updated_at = now() where id = '{V2}'$q$, 'OK', ''],
    array['controle', '106. une ligne du cadre 7 de 2024 venue d''un autre dossier est refusée, une de 2025 passe', 'chef', $q$do $x$ begin
        begin update vehicules set dossier_id = '{A}' where id = '{XV24}'; raise exception 'PASSÉE';
        exception when sqlstate '23514' then if sqlerrm <> 'L''exercice 2024 est validé : son cadre 7 ne change plus.' then raise; end if; end;
        update vehicules set dossier_id = '{A}' where id = '{XV25}'; end $x$$q$, 'OK', ''],
    array['controle', '107. une ligne du cadre 7 de 2024 ne quitte pas son dossier', 'chef', $q$update vehicules set dossier_id = '{X}' where id = '{V1}'$q$, '23514', 'L''exercice 2024 est validé : son cadre 7 ne change plus.'],
    array['controle', '108. une échéance payée en 2024', 'chef', $q$update cotisations_declarees set montant_csg_crds = 9 where id = '{C1}'$q$, '23514', 'L''exercice 2024 est validé : cette échéance ne change plus.'],
    array['controle', '109. sa sauvegarde sans changement passe', 'chef', $q$update cotisations_declarees set montant_appele = montant_appele where id = '{C1}'$q$, 'OK', ''],
    array['controle', '110. une échéance de 2024 payée en 2025 reste modifiable', 'chef', $q$update cotisations_declarees set montant_csg_crds = 9 where id = '{C2}'$q$, 'OK', ''],
    array['controle', '111. une échéance ajoutée en 2024 ou en 2023 est refusée, en 2025 elle passe', 'chef', $q$do $x$ begin
        begin insert into cotisations_declarees (dossier_id, echeance, montant_appele) values ('{A}', '2024-11-01', 50); raise exception 'PASSÉE';
        exception when sqlstate '23514' then if sqlerrm <> 'L''exercice 2024 est validé : une échéance ne s''y ajoute plus.' then raise; end if; end;
        begin insert into cotisations_declarees (dossier_id, echeance, montant_appele) values ('{A}', '2023-04-01', 50); raise exception 'PASSÉE';
        exception when sqlstate '23514' then if sqlerrm <> 'L''exercice 2023 est figé par la validation de l''exercice 2024 : une échéance ne s''y ajoute plus.' then raise; end if; end;
        insert into cotisations_declarees (dossier_id, echeance, montant_appele) values ('{A}', '2025-11-01', 50); end $x$$q$, 'OK', ''],
    array['controle', '112. une échéance de 2024 venue d''un autre dossier', 'chef', $q$update cotisations_declarees set dossier_id = '{A}' where id = '{XC24}'$q$, '23514', 'L''exercice 2024 est validé : une échéance ne s''y ajoute plus.'],
    array['controle', '113. une échéance payée en 2024 ne quitte pas son dossier', 'chef', $q$update cotisations_declarees set dossier_id = '{X}' where id = '{C1}'$q$, '23514', 'L''exercice 2024 est validé : cette échéance ne change plus.'],
    array['controle', '114. des à-nouveaux posés après la validation', 'chef', $q$insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{A}', '2024-01-01', '512000', 'debit', 1, 'essai.csv', repeat('a', 64))$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['controle', '115. ni par enregistrer_a_nouveaux, qui remplace l''ouverture', 'chef', $q$select enregistrer_a_nouveaux('{A}', '2025-01-01', 'essai.csv', repeat('a', 64), '[{"compte":"512000","sens":"debit","montant":1},{"compte":"101000","sens":"credit","montant":1}]'::jsonb)$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['controle', '116. ni venus d''un autre dossier', 'chef', $q$update a_nouveaux set dossier_id = '{A}' where id = '{XAN}'$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],

    -- ══ Le maillon de l'exercice suivant ═══════════════════════════════════════════════════════════════════════════
    array['jeu', 'le mouvement de 2025 à traiter est ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{M7}'$q$, '', ''],
    -- 2025 s'ouvre sur les soldes reportés de 2024 : ses libellés partent avec sa numérotation, comme ceux d'à-nouveaux
    -- repris — l'application les compose (`numeroterFec`) ; l'essai reprend le libellé de chaque solde.
    array['controle', '117a. 2025 ne se valide pas sans les libellés de son ouverture', 'chef', $q$select valider_exercice('{A}', 2025, '[{"id":"{E16}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Achats"},{"id":"{E17}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Banque"}]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les libellés proposés ne couvrent pas exactement les 3 à-nouveaux de l''exercice 2025.'],
    array['fait', '117. le chef valide 2025', 'chef', $q$select valider_exercice('{A}', 2025, '[{"id":"{E16}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Achats"},{"id":"{E17}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Banque"}]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{A}' and date = '2025-01-01'), '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '118. 2025 porte l''empreinte de 2024, et se vérifie', 'postgres', $q$select (b.empreinte_precedente = a.empreinte)::text || '/' || verifier_exercice_valide('{A}', 2025)::text from exercices_valides a, exercices_valides b where a.dossier_id = '{A}' and a.annee = 2024 and b.dossier_id = '{A}' and b.annee = 2025$q$, '', 'true/true'],
    -- Les libellés de l'ouverture de 2025 sont posés, et 2026 s'ouvre sur 2025 : la perte de 30 au capital individuel,
    -- la banque à 230 + 30, l'amortissement inchangé.
    array['valeur', '118b. l''ouverture de 2025 porte ses libellés, et 2026 s''ouvre sur les soldes de fin de 2025', 'postgres', $q$select (select string_agg(compte || ':' || compte_lib || ':' || ecriture_lib, ',' order by compte collate "C") from soldes_reportes where dossier_id = '{A}' and date = '2025-01-01') || '/' || string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(source_nom) || '/' || bool_and(source_empreinte = (select empreinte from exercices_valides where dossier_id = '{A}' and annee = 2025)) from soldes_reportes where dossier_id = '{A}' and date = '2026-01-01'$q$, '',
      '101000:Capital individuel:À-nouveau Capital individuel,281830:Amortissements:À-nouveau Amortissements,512000:Banque:À-nouveau Banque/101000:debit:660.00:Capital individuel,281830:credit:400.00:Amortissements,512000:credit:260.00:Banque/Exercice 2025 validé/true'],
    array['jeu', 'casser le maillon de 2024', 'postgres', $q$update exercices_valides set empreinte = repeat('0', 64) where dossier_id = '{A}' and annee = 2024$q$, '', ''],
    array['valeur', '119. un maillon cassé se voit sur l''exercice suivant', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text || '/' || verifier_exercice_valide('{A}', 2025)::text$q$, '', 'false/false'],

    -- ══ L'ordre, et l'engagement (F) ═══════════════════════════════════════════════════════════════════════════════
    array['jeu', 'écritures de 2023, non validées, dans F', 'postgres', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values
      ('{F}', '2023-05-01', '606100', 'ESSAI F', 10, 'debit'), ('{F}', '2023-05-01', '401000', 'ESSAI F', 10, 'credit')$q$, '', ''],
    array['controle', '120. les exercices se valident dans l''ordre', 'chef', $q$select valider_exercice('{F}', 2024, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514', 'L''exercice 2023 porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.'],
    array['controle', '121. en engagement, une 2035 est refusée', 'chef', $q$select valider_exercice('{F}', 2022, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un dossier tenu en engagement n''a pas de 2035.'],
    array['fait', '122. en engagement, un exercice vide se valide sans 2035', 'chef', $q$select valider_exercice('{F}', 2022, '[]'::jsonb, '[]'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '123. sans 2035, et marqué en engagement', 'postgres', $q$select mode_comptable || '/' || (declaration is null) || '/' || nb_lignes from exercices_valides where dossier_id = '{F}'$q$, '', 'engagement/true/0'],
    array['controle', '124. 2023 ne se saute pas', 'chef', $q$select valider_exercice('{F}', 2024, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514', 'L''exercice 2023 n''est pas validé : les exercices se valident dans l''ordre.'],

    -- ══ L'ouverture (G, repris au 1er janvier 2025 ; H, au 1er janvier 2024) ═══════════════════════════════════════
    array['jeu', 'à-nouveaux de G', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{GAN1}', '{G}', '2025-01-01', '512000', 'Banque Populaire', 'debit', 10, 'balance-essai.csv', repeat('a', 64)),
      ('{GAN2}', '{G}', '2025-01-01', '101000', 'Capital', 'credit', 10, 'balance-essai.csv', repeat('a', 64))$q$, '', ''],
    array['jeu', 'un mouvement de G antérieur à son ouverture', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{GM}', '{G}', '2024-12-15', 'ESSAI AVANT OUVERTURE', -4, 'non_rapprochee')$q$, '', ''],
    array['jeu', 'écritures de G, deux en 2025 et deux antérieures à son ouverture', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{GE1}', '{G}', '2025-05-01', '606100', 'ESSAI G', 10, 'debit'), ('{GE2}', '{G}', '2025-05-01', '512000', 'ESSAI G', 10, 'credit'),
      ('{GE3}', '{G}', '2024-06-01', '606100', 'ESSAI G AVANT', 3, 'debit'), ('{GE4}', '{G}', '2024-06-01', '512000', 'ESSAI G AVANT', 3, 'credit')$q$, '', ''],
    array['jeu', 'la numérotation de G 2025, écritures redatées comprises', 'postgres', $q$select set_config('essai.g', $j$[
      {"id":"{GE1}","journal":"AC","numero":1,"piece_ref":"essai-g1.pdf","piece_date":"2025-05-01","compte_lib":"Achats"},
      {"id":"{GE2}","journal":"AC","numero":1,"piece_ref":"essai-g1.pdf","piece_date":"2025-05-01","compte_lib":"Banque"},
      {"id":"{GE3}","journal":"AC","numero":2,"piece_ref":"essai-g2.pdf","piece_date":"2025-05-02","compte_lib":"Achats"},
      {"id":"{GE4}","journal":"AC","numero":2,"piece_ref":"essai-g2.pdf","piece_date":"2025-05-02","compte_lib":"Banque"}
    ]$j$, true)$q$, '', ''],
    array['controle', '125. un exercice antérieur à l''ouverture ne se valide pas', 'chef', $q$select valider_exercice('{G}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'L''exercice 2024 précède l''ouverture du dossier : il est dans les comptes repris.'],
    array['controle', '126. des écritures antérieures à l''ouverture : les retirer ou les redater', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'Des écritures antérieures à l''ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.'],
    array['jeu', 'les écritures antérieures sont redatées, comme le refus le conseille', 'postgres', $q$update ecritures_brouillon set date = '2025-05-02' where id in ('{GE3}', '{GE4}')$q$, '', ''],
    array['controle', '127. un mouvement antérieur à l''ouverture reste à traiter', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'Des mouvements bancaires antérieurs à l''ouverture du dossier restent à traiter : les ignorer avant la validation.'],
    array['jeu', 'le mouvement antérieur est ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{GM}'$q$, '', ''],
    array['controle', '128. les libellés des à-nouveaux manquent', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les libellés proposés ne couvrent pas exactement les 2 à-nouveaux de l''exercice 2025.'],
    array['controle', '129. un à-nouveau sans libellé d''écriture', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[{"id":"{GAN1}","compte_lib":"Banque","ecriture_lib":" "},{"id":"{GAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un à-nouveau proposé est incomplet.'],
    array['controle', '130. la banque nommée autrement dans les à-nouveaux', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[{"id":"{GAN1}","compte_lib":"Banque Populaire","ecriture_lib":"À-nouveau Banque Populaire"},{"id":"{GAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un même compte porte deux libellés.'],
    array['fait', '131. le chef valide 2025 avec ses à-nouveaux', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[{"id":"{GAN1}","compte_lib":"Banque","ecriture_lib":"À-nouveau Banque Populaire"},{"id":"{GAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '132. les à-nouveaux portent leurs libellés, l''exercice ses quatre lignes', 'postgres', $q$select string_agg(compte || ':' || compte_lib || ':' || ecriture_lib, ',' order by compte collate "C") || '/' || (select nb_lignes || '-' || nb_ecritures from exercices_valides where dossier_id = '{G}') from a_nouveaux where dossier_id = '{G}'$q$, '', '101000:Capital:À-nouveau Capital,512000:Banque:À-nouveau Banque Populaire/4-2'],
    -- Une ouverture reprise se reporte comme une autre : le capital repris (10) reçoit la perte de 2025 (13), sous le
    -- libellé que 2025 lui a figé ; la banque garde le sien, pas celui de la balance reprise.
    array['valeur', '132b. 2026 s''ouvre sur les soldes de fin de 2025, ouverture reprise comprise', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(date) from soldes_reportes where dossier_id = '{G}'$q$, '',
      '101000:debit:3.00:Capital,512000:credit:3.00:Banque/2026-01-01'],
    array['controle', '133. l''ouverture validée ne change plus', 'chef', $q$update a_nouveaux set libelle = 'x' where id = '{GAN1}'$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['controle', '134. ni ne quitte son dossier', 'chef', $q$update a_nouveaux set dossier_id = '{X}' where id = '{GAN2}'$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['jeu', 'falsifier un libellé d''à-nouveau hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update a_nouveaux set ecriture_lib = 'falsifié' where id = '{GAN2}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '135. un libellé d''à-nouveau falsifié se voit', 'postgres', $q$select verifier_exercice_valide('{G}', 2025)::text$q$, '', 'false'],
    array['jeu', 'à-nouveaux de H, au 1er janvier 2024', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{HAN1}', '{H}', '2024-01-01', '512000', 'Banque', 'debit', 5, 'balance-essai-h.csv', repeat('b', 64)),
      ('{HAN2}', '{H}', '2024-01-01', '101000', 'Capital', 'credit', 5, 'balance-essai-h.csv', repeat('b', 64))$q$, '', ''],
    array['controle', '136. l''exercice des à-nouveaux se valide d''abord', 'chef', $q$select valider_exercice('{H}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 porte les à-nouveaux du dossier : il se valide d''abord.'],
    array['fait', '137. 2024, sans écriture, se valide avec ses à-nouveaux', 'chef', $q$select valider_exercice('{H}', 2024, '[]'::jsonb, '[{"id":"{HAN1}","compte_lib":"Banque","ecriture_lib":"À-nouveau Banque"},{"id":"{HAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['fait', '138. puis 2025', 'chef', $q$select valider_exercice('{H}', 2025, '[]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{H}' and date = '2025-01-01'), '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '139. la chaîne de H tient', 'postgres', $q$select (b.empreinte_precedente = a.empreinte)::text || '/' || verifier_exercice_valide('{H}', 2024)::text || '/' || verifier_exercice_valide('{H}', 2025)::text from exercices_valides a, exercices_valides b where a.dossier_id = '{H}' and a.annee = 2024 and b.dossier_id = '{H}' and b.annee = 2025$q$, '', 'true/true/true'],
    -- Sans écriture, l'ouverture se reporte telle quelle d'un exercice sur l'autre.
    array['valeur', '139b. H s''ouvre en 2025 puis en 2026 sur les soldes de sa reprise', 'postgres', $q$select string_agg(to_char(date, 'YYYY') || ':' || compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by date, compte collate "C") from soldes_reportes where dossier_id = '{H}'$q$, '',
      '2025:101000:credit:5.00:Capital,2025:512000:debit:5.00:Banque,2026:101000:credit:5.00:Capital,2026:512000:debit:5.00:Banque'],

    -- ══ Ce que le catalogue dit, faute de pouvoir le jouer ═════════════════════════════════════════════════════════
    array['valeur', '140. chaque déclencheur figeant refuse aussi la suppression, et il est actif', 'postgres', $q$select string_agg(c.relname || ':' || ((t.tgtype & 8) <> 0)::text || ':' || t.tgenabled::text, ',' order by c.relname collate "C") from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname in ('ecritures_brouillon_intangibles', 'pieces_figees_par_la_validation', 'lignes_bancaires_figees_par_la_validation', 'ventilations_bancaires_figees_par_la_validation', 'reglements_groupes_figes_par_la_validation', 'immobilisations_figees_par_la_validation', 'vehicules_figes_par_la_validation', 'cotisations_declarees_figees_par_la_validation', 'a_nouveaux_figes_par_la_validation', 'declarations_tva_figees_par_la_validation', 'soldes_reportes_ecrits_par_la_validation')$q$, '',
      'a_nouveaux:true:O,cotisations_declarees:true:O,declarations_tva:true:O,ecritures_brouillon:true:O,immobilisations:true:O,lignes_bancaires:true:O,pieces:true:O,reglements_groupes:true:O,soldes_reportes:true:O,vehicules:true:O,ventilations_bancaires:true:O'],
    -- 141 part de TOUS les déclencheurs posés avant une suppression, lus du catalogue (voir l'en-tête).
    array['valeur', '141. tout déclencheur qui garde une suppression laisse passer la cascade d''un dossier qu''on supprime', 'postgres', $q$select count(*) || ' ' || string_agg(c.relname || '.' || t.tgname || ':' || p.proname || ':' || case when regexp_replace(p.prosrc, '\s+', ' ', 'g') ~ 'not exists \(select 1 from public\.dossiers( [a-z_]+)? where ([a-z_]+\.)?id = old\.dossier_id\)' then 'dossier' when not exists (select 1 from pg_attribute a where a.attrelid = t.tgrelid and a.attname = 'dossier_id' and not a.attisdropped) then 'parent:' || coalesce((select string_agg(k.confrelid::regclass::text, '+' order by k.confrelid::regclass::text collate "C") from pg_constraint k where k.conrelid = t.tgrelid and k.contype = 'f' and k.confdeltype = 'c'), 'aucun') else '?' end || ':' || t.tgenabled::text, ',' order by c.relname collate "C", t.tgname collate "C") from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and (t.tgtype & 2) <> 0 and (t.tgtype & 8) <> 0 and p.proname not in ('garder_operation_caisse', 'garder_ecriture_de_caisse')$q$, '',
      '43 a_nouveaux.a_nouveaux_figes_par_la_validation:garder_a_nouveaux_valides:dossier:O,adresses_reception.adresses_reception_gardes:garder_adresse_reception:dossier:O,cotisations_declarees.cotisations_declarees_figees_par_la_validation:garder_cotisation_valide:dossier:O,declarations_ereporting.declarations_ereporting_gardes:garder_declaration_ereporting:dossier:O,declarations_ereporting_sources.declarations_ereporting_sources_gardes:garder_source_declaree:dossier:O,declarations_tva.declarations_tva_figees_par_la_validation:garder_declaration_valide:dossier:O,designations_des_pieces.designations_des_pieces_gardes:garder_designation_des_pieces:dossier:O,documents_divers.documents_divers_cites_en_revision:garder_source_citee:dossier:O,dossier_permanent.dossier_permanent_gardes:garder_dossier_permanent:dossier:O,ecritures_brouillon.ecritures_brouillon_intangibles:garder_ecritures_validees:dossier:O,ecritures_brouillon.ecritures_brouillon_paiement_personnel:garder_ecriture_paiement_personnel:dossier:O,ecritures_brouillon.ecritures_brouillon_vente_facturee_lignes:garder_lignes_de_la_vente_facturee:dossier:O,encaissements_factures.encaissements_factures_gardes:garder_encaissement_facture:dossier:O,encaissements_factures.encaissements_factures_gardes_frontiere:garder_frontiere_des_encaissements:dossier:O,encaissements_factures_taux.encaissements_factures_taux_gardes:garder_encaissement_facture_taux:dossier:O,encaissements_factures_taux.encaissements_factures_taux_gardes_frontiere:garder_frontiere_des_encaissements:dossier:O,facture_lignes.facture_lignes_figees:garder_lignes_facture_validee:parent:factures_emises:O,factures_emises.factures_emises_figees:garder_factures_validees:dossier:O,immobilisations.immobilisations_figees_par_la_validation:garder_bien_valide:dossier:O,justificatifs_proposes.justificatifs_proposes_gardes:garder_justificatif_propose:dossier:O,lignes_bancaires.lignes_bancaires_figees_par_la_validation:garder_mouvement_valide:dossier:O,parametres_facturation.parametres_facturation_gardes:garder_parametres_facturation:dossier:O,pieces.pieces_citees_en_revision:garder_source_citee:dossier:O,pieces.pieces_declarees_ereporting:garder_piece_declaree:dossier:O,pieces.pieces_figees_par_la_validation:garder_piece_validee:dossier:O,pieces_ecartees_ereporting.pieces_ecartees_ereporting_gardes:garder_ecart_ereporting:dossier:O,pieces_hors_de_france.pieces_hors_de_france_gardes:garder_fiche_hors_de_france:dossier:O,pieces_hors_de_france_taux.pieces_hors_de_france_taux_gardes:garder_fiche_hors_de_france_taux:dossier:O,plan_comptable_dossier.plan_comptable_dossier_gardes:garder_plan_comptable_dossier:dossier:O,regimes_ereporting.regimes_ereporting_gardes:garder_regime_ereporting:dossier:O,reglements_groupes.reglements_groupes_figes_par_la_validation:garder_parts_mouvement_valide:dossier:O,revision_conclusions.revision_conclusions_gardes:garder_revision_conclusion:dossier:O,revision_explications.revision_explications_gardes:garder_revision_explication:dossier:O,revision_justifications.revision_justifications_gardes:garder_revision_justification:dossier:O,revision_notes.revision_notes_gardes:garder_revision_note:dossier:O,revision_preuves.revision_preuves_gardes:garder_revision_preuve:dossier:O,revision_revues.revision_revues_gardes:garder_revision_revue:dossier:O,revision_seuils.revision_seuils_gardes:garder_revision_seuil:dossier:O,soldes_reportes.soldes_reportes_ecrits_par_la_validation:garder_soldes_reportes:dossier:O,statuts_factures_recus.statuts_factures_recus_gardes:garder_statut_facture_recu:dossier:O,transmissions_encaissements.transmissions_encaissements_gardees:garder_transmission_encaissement:dossier:O,vehicules.vehicules_figes_par_la_validation:garder_vehicule_valide:dossier:O,ventilations_bancaires.ventilations_bancaires_figees_par_la_validation:garder_parts_mouvement_valide:dossier:O'],
    -- 141b : les deux gardes de la caisse (ligne 26.6, étape C1 ; migration `caisse`, préparée), que 141 écarte.
    array['valeur', '141b. puis rien, ou, la migration caisse appliquée, ses deux gardes, actives, qui laissent passer la cascade d''un dossier qu''on supprime', 'postgres', $q$select (case when to_regclass('public.operations_caisse') is null then count(*) = 0 else count(*) = 2 and bool_and(t.tgenabled = 'O' and regexp_replace(p.prosrc, '\s+', ' ', 'g') ~ 'not exists \(select 1 from public\.dossiers( [a-z_]+)? where ([a-z_]+\.)?id = old\.dossier_id\)') end)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and (t.tgtype & 2) <> 0 and (t.tgtype & 8) <> 0 and p.proname in ('garder_operation_caisse', 'garder_ecriture_de_caisse')$q$, '',
      'true'],
    array['valeur', '142. un exercice validé part avec son dossier', 'postgres', $q$select string_agg(confdeltype::text, ',') from pg_constraint where conrelid = 'public.exercices_valides'::regclass and contype = 'f'$q$, '', 'c'],
    array['valeur', '143. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('valider_exercice', '(uuid, integer, jsonb, jsonb, jsonb)'), ('verifier_exercice_valide', '(uuid, integer)'), ('empreinte_exercice', '(uuid, integer, text)'),
      ('cle_validation', '(uuid)'), ('frontiere_validation', '(uuid)'), ('exercice_fige', '(uuid, integer)'), ('garder_ecritures_validees', '()'),
      ('garder_soldes_reportes', '()'), ('soldes_a_reporter', '(uuid, integer)')) as t(f, a)$q$, '',
      'cle_validation:false:false,empreinte_exercice:false:true,exercice_fige:false:false,frontiere_validation:false:false,garder_ecritures_validees:false:false,garder_soldes_reportes:false:false,soldes_a_reporter:false:false,valider_exercice:false:true,verifier_exercice_valide:false:true'],
    array['valeur', '144. un exercice validé est lu par le cabinet, réinséré par le super-administrateur, jamais modifié', 'postgres', $q$select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ',' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename = 'exercices_valides'$q$, '',
      'exercices_valides_lecture:SELECT:authenticated,exercices_valides_restauration:INSERT:authenticated'],

    -- ══ 150 à 190. Les quatre champs du FEC d'un BNC en trésorerie (lot FEC22b ; genre « …f ») ═══════════════════
    -- K, tenu en trésorerie : un achat payé par le relevé (AC 1), une vente payée par le relevé (VE 1), une recette
    -- affectée (BQ 1), une dotation (OD 1). RF, sans exercice validé : la restauration.
    array['jeuf', 'dossiers jetables K et RF', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable) values
      ('{K}', 'ESSAI VALIDATION K', '{CAB}', 'tresorerie'), ('{RF}', 'ESSAI VALIDATION RF', '{CAB}', 'tresorerie')$q$, '', ''],
    array['jeuf', 'pièces de K', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece) values
      ('{PK1}', '{K}', 'essai/validation/k1.pdf', 'essai-k1.pdf', 'validee', 'achat', 120, '2024-03-01'),
      ('{PK2}', '{K}', 'essai/validation/k2.pdf', 'essai-k2.pdf', 'validee', 'vente', 200, '2024-05-01')$q$, '', ''],
    array['jeuf', 'mouvements de K', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, categorie_id) values
      ('{MK1}', '{K}', '2024-03-05', 'ESSAI K PRLV', -120, 'rapprochee', '{PK1}', null),
      ('{MK2}', '{K}', '2024-05-10', 'ESSAI K VIR', 200, 'rapprochee', '{PK2}', null),
      ('{MK3}', '{K}', '2024-06-01', 'ESSAI K CPAM', 50, 'rapprochee', null, '{CAT}')$q$, '', ''],
    array['jeuf', 'bien de K', 'postgres', $q$insert into immobilisations (id, dossier_id, libelle, valeur, date_acquisition, duree_annees) values ('{BK}', '{K}', 'ESSAI K Bien', 300, '2024-01-15', 3)$q$, '', ''],
    array['jeuf', 'écritures de K', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, date, compte, libelle, montant, sens) values
      ('{EK1}', '{K}', '{PK1}', null, null, '2024-03-05', '606100', 'ESSAI K1', 120, 'debit'),
      ('{EK2}', '{K}', '{PK1}', '{MK1}', null, '2024-03-05', '512000', 'ESSAI K1', 120, 'credit'),
      ('{EK3}', '{K}', '{PK2}', '{MK2}', null, '2024-05-10', '512000', 'ESSAI K2', 200, 'debit'),
      ('{EK4}', '{K}', '{PK2}', null, null, '2024-05-10', '706000', 'ESSAI K2', 200, 'credit'),
      ('{EK5}', '{K}', null, '{MK3}', null, '2024-06-01', '512000', 'ESSAI K3', 50, 'debit'),
      ('{EK6}', '{K}', null, '{MK3}', null, '2024-06-01', '706000', 'ESSAI K3', 50, 'credit'),
      ('{EK7}', '{K}', null, null, '{BK}', '2024-12-31', '681100', 'ESSAI K DOTATION', 100, 'debit'),
      ('{EK8}', '{K}', null, null, '{BK}', '2024-12-31', '281830', 'ESSAI K DOTATION', 100, 'credit')$q$, '', ''],
    -- Six documents de K validés par le chef, dans cet ordre : F2024-0001 (un SIRET juste), F2024-0002 (un SIREN que sa
    -- clé refuse, au SIRET que la sienne passe), A2024-0001 (son avoir), F2024-0003 (un SIREN juste, un SIRET que sa clé refuse), F2024-0004 (un SIREN
    -- seul), F2024-0005 (un SIRET juste écrit avec des blancs) ; puis un brouillon de K, au SIRET juste, et une facture
    -- validée de X. Tous FICTIFS. Les documents de La Poste se valident chacun dans l'étape qui le juge, annulée avec
    -- elle (163j, 164c, 164d) : deux documents au même SIREN se couvriraient l'un l'autre.
    array['faitf', '150. le jeu : les documents de K, validés par le chef', 'chef', $q${ENF}'{K}', null, {FK} || '{"tiers_siret":"99900010200015","date_emission":"2024-02-01"}', {LK}, true);
      {ENF}'{K}', null, {FK} || '{"tiers_siret":"99900070000008","date_emission":"2024-02-02"}', {LK}, true);
      {ENF}'{K}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', (select id from factures_emises where dossier_id = '{K}' and numero = 'F2024-0002'), 'date_emission', '2024-02-03', 'montant_ht', -50, 'montant_tva', -10, 'montant_ttc', -60), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, true);
      {ENF}'{K}', null, {FK} || '{"tiers_siret":"99900030000010","date_emission":"2024-02-04"}', {LK}, true);
      {ENF}'{K}', null, {FK} || '{"tiers_siret":"999000201","date_emission":"2024-02-05"}', {LK}, true);
      {ENF}'{K}', null, {FK} || '{"tiers_siret":"999 000 607 00013","date_emission":"2024-02-07"}', {LK}, true)$q$, 'OK', ''],
    array['faitf', '150b. le jeu : un brouillon de K, et une facture validée de X', 'chef', $q${ENF}'{K}', null, {FK} || '{"tiers_siret":"99900040900014","date_emission":"2024-02-08"}', {LK}, false);
      {ENF}'{X}', null, {FK} || '{"tiers_siret":"99900050800013","date_emission":"2023-02-01"}', {LK}, true)$q$, 'OK', ''],
    array['valeurf', '150c. les documents de K et de X, leurs numéros et leurs SIRET', 'postgres', $q$select string_agg(coalesce(numero, '∅') || ':' || statut || ':' || tiers_siret, ',' order by coalesce(numero, '∅') collate "C") from factures_emises where dossier_id in ('{K}', '{X}')$q$, '',
      'A2024-0001:validee:99900070000008,F2023-0001:validee:99900050800013,F2024-0001:validee:99900010200015,F2024-0002:validee:99900070000008,F2024-0003:validee:99900030000010,F2024-0004:validee:999000201,F2024-0005:validee:999 000 607 00013,∅:brouillon:99900040900014'],
    -- La numérotation de K 2024 que l'application composerait, ses quatre champs compris (FEC22a) : le règlement par le
    -- relevé, « Banque » (FEC22-Q2) ; la vente identifiée par le SIREN de F2024-0001, la recette par le numéro de l'avoir ;
    -- la dotation sans règlement, ses champs vides (FEC22-Q1, l'option « vides ») ; le poste sur les lignes de résultat
    -- seulement. Ses variantes fautives en dérivent, par le rang de la ligne : 0 et 1 l'achat, 2 et 3 la vente, 4 et 5 la
    -- recette, 6 et 7 la dotation.
    array['jeuf', 'la numérotation de K 2024 et ses quatre champs', 'postgres', $q$select set_config('essai.k', $j$[
      {"id":"{EK1}","journal":"AC","numero":1,"piece_ref":"essai-k1.pdf","piece_date":"2024-03-01","compte_lib":"Achats","date_reglement":"2024-03-05","mode_reglement":"Banque","nature_operation":"Dépense","poste_rattache":"Achats"},
      {"id":"{EK2}","journal":"AC","numero":1,"piece_ref":"essai-k1.pdf","piece_date":"2024-03-01","compte_lib":"Banque","date_reglement":"2024-03-05","mode_reglement":"Banque","nature_operation":"Dépense"},
      {"id":"{EK3}","journal":"VE","numero":1,"piece_ref":"essai-k2.pdf","piece_date":"2024-05-01","compte_lib":"Banque","date_reglement":"2024-05-10","mode_reglement":"Banque","nature_operation":"Recette","identification_client":"999000102"},
      {"id":"{EK4}","journal":"VE","numero":1,"piece_ref":"essai-k2.pdf","piece_date":"2024-05-01","compte_lib":"Honoraires","date_reglement":"2024-05-10","mode_reglement":"Banque","nature_operation":"Recette","poste_rattache":"Recettes","identification_client":"999000102"},
      {"id":"{EK5}","journal":"BQ","numero":1,"piece_ref":"Relevé essai K","piece_date":"2024-06-01","compte_lib":"Banque","date_reglement":"2024-06-01","mode_reglement":"Banque","nature_operation":"Recette","identification_client":"A2024-0001"},
      {"id":"{EK6}","journal":"BQ","numero":1,"piece_ref":"Relevé essai K","piece_date":"2024-06-01","compte_lib":"Honoraires","date_reglement":"2024-06-01","mode_reglement":"Banque","nature_operation":"Recette","poste_rattache":"Gains divers","identification_client":"A2024-0001"},
      {"id":"{EK7}","journal":"OD","numero":1,"piece_ref":"Tableau d'amortissement 2024","piece_date":"2024-12-31","compte_lib":"Dotations","nature_operation":"Dotation aux amortissements","poste_rattache":"Amortissements"},
      {"id":"{EK8}","journal":"OD","numero":1,"piece_ref":"Tableau d'amortissement 2024","piece_date":"2024-12-31","compte_lib":"Amortissements","nature_operation":"Dotation aux amortissements"}
    ]$j$, true)$q$, '', ''],
    -- Chaque valeur dans sa forme.
    array['controlef', '151. une date de règlement illisible : un jour hors de son mois', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,date_reglement}', '"2024-02-30"'), '{1,date_reglement}', '"2024-02-30"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte une date de règlement illisible.'],
    array['controlef', '151b. … un texte vide, qui n''est pas une date nulle', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,date_reglement}', '""'), '{1,date_reglement}', '""'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte une date de règlement illisible.'],
    array['controlef', '151c. … une autre forme que AAAA-MM-JJ', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,date_reglement}', '"05/03/2024"'), '{1,date_reglement}', '"05/03/2024"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte une date de règlement illisible.'],
    array['controlef', '152. une date de règlement postérieure à aujourd''hui, à Paris', 'chef', format($q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,date_reglement}', '"%1$s"'), '{1,date_reglement}', '"%1$s"'){FIN}$q$, to_char(aujourd_hui + 2, 'YYYY-MM-DD')), '22023',
      'Une ligne de la numérotation proposée porte une date de règlement postérieure à aujourd''hui.'],
    array['controlef', '152b. MUTATION de 152 : le jour même, à Paris, passe', 'chef', format($q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,date_reglement}', '"%1$s"'), '{1,date_reglement}', '"%1$s"'){FIN}$q$, to_char(aujourd_hui, 'YYYY-MM-DD')), 'OK', ''],
    array['controlef', '153. un mode de règlement hors de sa liste', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,mode_reglement}', '"Cheque"'), '{1,mode_reglement}', '"Cheque"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.'],
    array['controlef', '153b. … un mode vide, qui n''est pas un mode nul', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,mode_reglement}', '""'), '{1,mode_reglement}', '""'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.'],
    array['controlef', '154. une nature d''opération hors de sa liste — la nature d''un soin', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,nature_operation}', '"Soins infirmiers"'), '{1,nature_operation}', '"Soins infirmiers"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte une nature d''opération hors de sa liste.'],
    array['controlef', '155. un poste de la 2035 hors de sa liste — son orthographe comprise', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"achats"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 hors de sa liste.'],
    array['controlef', '156. un poste sans nature', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{0,nature_operation}', 'null'), '{1,nature_operation}', 'null'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 sans nature d''opération.'],
    array['controlef', '157. un poste sur la banque, qui n''est ni une charge ni un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,poste_rattache}', '"Achats"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 sur un compte qui n''est ni de charge ni de produit.'],
    array['controlef', '158. un poste de dépenses sur un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,poste_rattache}', '"Achats"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158b. … un poste de recettes sur une charge', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Recettes"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    -- Les deux cases qui se retranchent des recettes, les débours (AB) et les honoraires rétrocédés (AC), ne reçoivent
    -- qu'une DÉPENSE (`cadreCompatible`, src/lib/cases2035.ts) : la rétrocession payée à un remplaçant est une charge
    -- (622600), sous le poste « Honoraires rétrocédés ». Sur un produit, leur poste se refuse ; sur une charge, il passe.
    array['controlef', '158c. … les honoraires rétrocédés sur un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,poste_rattache}', '"Honoraires rétrocédés"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158d. MUTATION de 158c : sur une charge, la rétrocession payée à un remplaçant, ils passent', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Honoraires rétrocédés"'){FIN}$q$, 'OK', ''],
    array['controlef', '158e. … les débours payés pour le compte des clients sur un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,poste_rattache}', '"Débours payés pour le compte des clients"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158f. MUTATION de 158e : sur une charge, ils passent', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Débours payés pour le compte des clients"'){FIN}$q$, 'OK', ''],
    -- Les quatre postes de l'étape 2035S1 (src/lib/cases2035.ts), entrés dans les listes fermées le 01/11/2026 : les
    -- indemnités journalières, rangées en gains divers (AF), vont sur un produit — la ligne 5 de K, la recette affectée ;
    -- les redevances de collaboration (BG), les cotisations facultatives Madelin et le plan d'épargne retraite (BK), sur
    -- une charge — la ligne 0, l'achat. De l'autre côté, leur poste se refuse.
    array['controlef', '158g. les indemnités journalières sur une charge', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Indemnités journalières"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158h. MUTATION de 158g : sur un produit, elles passent', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{5,poste_rattache}', '"Indemnités journalières"'){FIN}$q$, 'OK', ''],
    array['controlef', '158i. … les redevances de collaboration sur un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,poste_rattache}', '"Redevances de collaboration"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158j. MUTATION de 158i : sur une charge, elles passent', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Redevances de collaboration"'){FIN}$q$, 'OK', ''],
    array['controlef', '158k. … les cotisations facultatives Madelin sur un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,poste_rattache}', '"Cotisations facultatives Madelin"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158l. MUTATION de 158k : sur une charge, elles passent', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Cotisations facultatives Madelin"'){FIN}$q$, 'OK', ''],
    array['controlef', '158m. … le plan d''épargne retraite sur un produit', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,poste_rattache}', '"Plan d''épargne retraite"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.'],
    array['controlef', '158n. MUTATION de 158m : sur une charge, il passe', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{0,poste_rattache}', '"Plan d''épargne retraite"'){FIN}$q$, 'OK', ''],
    -- Les mêmes sur toutes les lignes d'une écriture ; le poste suit la ligne (FEC22-Q3, (C)).
    array['controlef', '159. deux dates de règlement dans une écriture', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,date_reglement}', '"2024-03-06"'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas la même date de règlement.'],
    array['controlef', '159b. … une date sur une ligne, aucune sur l''autre', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,date_reglement}', 'null'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas la même date de règlement.'],
    array['controlef', '160. deux modes de règlement dans une écriture', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,mode_reglement}', '"Chèque"'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas le même mode de règlement.'],
    array['controlef', '160b. … un mode sur une ligne, aucun sur l''autre', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,mode_reglement}', 'null'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas le même mode de règlement.'],
    array['controlef', '161. deux natures dans une écriture', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,nature_operation}', '"Recette"'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas la même nature d''opération.'],
    array['controlef', '161b. … une nature sur une ligne, aucune sur l''autre', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1,nature_operation}', 'null'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas la même nature d''opération.'],
    array['controlef', '162. deux identifications du client dans une écriture', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,identification_client}', '"F2024-0001"'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas la même identification du client.'],
    array['controlef', '162b. … une identification sur une ligne, aucune sur l''autre', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{3,identification_client}', 'null'){FIN}$q$, '22023',
      'Les lignes d''une même écriture ne portent pas la même identification du client.'],
    -- Une écriture, c'est un journal ET un numéro : deux écritures d'un même journal portent chacune les leurs.
    array['controlef', '162c. MUTATION de 159 à 162 : deux écritures d''un même journal, à deux dates, chacune son client, passent', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set(jsonb_set(jsonb_set({JK}, '{2,journal}', '"AC"'), '{3,journal}', '"AC"'), '{2,numero}', '2'), '{3,numero}', '2'){FIN}$q$, 'OK', ''],
    -- LA GARDE DU SECRET : le numéro d'un document validé du dossier, ou le SIREN juste de son client figé, rien d'autre.
    array['controlef', '163. un nom pour client', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"ESSAI DUPONT"'), '{3,identification_client}', '"ESSAI DUPONT"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163b. le SIREN d''une facture de K restée en brouillon', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"999000409"'), '{3,identification_client}', '"999000409"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163c. le SIREN d''une facture validée d''un autre dossier', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"999000508"'), '{3,identification_client}', '"999000508"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163d. … et son numéro', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"F2023-0001"'), '{3,identification_client}', '"F2023-0001"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163e. un SIREN que sa clé refuse', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"999000700"'), '{3,identification_client}', '"999000700"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163f. le SIREN d''un SIRET que sa clé refuse', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"999000300"'), '{3,identification_client}', '"999000300"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163g. le SIRET entier, pas son SIREN', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"99900010200015"'), '{3,identification_client}', '"99900010200015"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163h. le SIREN d''un SIRET écrit avec des blancs, qui ne se corrige pas', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"999000607"'), '{3,identification_client}', '"999000607"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '164. MUTATION de 163 : le numéro d''une facture validée de K passe', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"F2024-0002"'), '{3,identification_client}', '"F2024-0002"'){FIN}$q$, 'OK', ''],
    array['controlef', '164b. … le SIREN saisi seul, quand sa clé le passe', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"999000201"'), '{3,identification_client}', '"999000201"'){FIN}$q$, 'OK', ''],
    -- La Poste (SIREN 356000000) : un document validé dans l'étape même, annulé avec elle, seul à porter ce SIREN. Ses
    -- établissements passent quand la somme de leurs chiffres est un multiple de cinq (35600000000001 : 15), pas
    -- autrement (35600000000002 : 16) ; son siège, 35600000000048, par la clé de Luhn (la somme de ses chiffres, 26,
    -- ne le passerait pas).
    array['controlef', '164c. … le SIREN d''un établissement de La Poste', 'chef', $q${ENF}'{K}', null, {FK} || '{"tiers_siret":"35600000000001","date_emission":"2024-02-07"}', {LK}, true); {VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"356000000"'), '{3,identification_client}', '"356000000"'){FIN}$q$, 'OK', ''],
    array['controlef', '164d. … et celui du siège de La Poste, que la règle de ses établissements refuserait', 'chef', $q${ENF}'{K}', null, {FK} || '{"tiers_siret":"35600000000048","date_emission":"2024-02-07"}', {LK}, true); {VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"356000000"'), '{3,identification_client}', '"356000000"'){FIN}$q$, 'OK', ''],
    array['controlef', '163j. le SIREN d''un établissement de La Poste que sa règle refuse', 'chef', $q${ENF}'{K}', null, {FK} || '{"tiers_siret":"35600000000002","date_emission":"2024-02-07"}', {LK}, true); {VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '"356000000"'), '{3,identification_client}', '"356000000"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    array['controlef', '163i. une identification vide, qui n''est pas une identification nulle', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set({JK}, '{2,identification_client}', '""'), '{3,identification_client}', '""'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée identifie le client autrement que par le numéro d''une facture validée du dossier ou par le SIREN qu''elle porte.'],
    -- L'ordre : le premier défaut l'emporte, et un défaut d'hier l'emporte sur un champ neuf.
    array['controlef', '165. deux défauts : le mode hors de sa liste avant le nom pour client', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set(jsonb_set(jsonb_set({JK}, '{0,mode_reglement}', '"Cheque"'), '{1,mode_reglement}', '"Cheque"'), '{2,identification_client}', '"ESSAI DUPONT"'), '{3,identification_client}', '"ESSAI DUPONT"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.'],
    array['controlef', '165b. … la date illisible avant la nature hors de sa liste', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set(jsonb_set(jsonb_set({JK}, '{0,date_reglement}', '"2024-13-01"'), '{1,date_reglement}', '"2024-13-01"'), '{0,nature_operation}', '"Soins"'), '{1,nature_operation}', '"Soins"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée porte une date de règlement illisible.'],
    array['controlef', '165c. … un défaut d''hier, un journal inconnu, avant un champ neuf', 'chef', $q${VAL}'{K}', 2024, jsonb_set(jsonb_set(jsonb_set(jsonb_set({JK}, '{0,journal}', '"XX"'), '{1,journal}', '"XX"'), '{0,mode_reglement}', '"Cheque"'), '{1,mode_reglement}', '"Cheque"'){FIN}$q$, '22023',
      'Une ligne de la numérotation proposée est incomplète.'],
    -- Une ligne du brouillon ne porte qu'UN jeu de valeurs : la numérotation qui la scinderait entre deux écritures du
    -- FEC — une pièce payée le même jour par deux modes, deux numéros et deux modes pour la même ligne de charge — ne la
    -- couvre pas exactement, et se refuse par le refus d'hier (19), avant tout champ neuf ; de même sous le même
    -- numéro, et quand la seconde occurrence prend la place d'une autre ligne (le compte des lignes reçues juste).
    array['controlef', '166. une ligne scindée entre deux écritures : deux numéros, deux modes de règlement', 'chef', $q${VAL}'{K}', 2024, {JK} || jsonb_build_array(jsonb_set(jsonb_set({JK} -> 0, '{numero}', '2'), '{mode_reglement}', '"Espèces"')){FIN}$q$, '22023',
      'La numérotation proposée ne couvre pas exactement les 8 écritures de l''exercice 2024.'],
    array['controlef', '166b. … sous le même numéro, deux modes de règlement', 'chef', $q${VAL}'{K}', 2024, {JK} || jsonb_build_array(jsonb_set({JK} -> 0, '{mode_reglement}', '"Espèces"')){FIN}$q$, '22023',
      'La numérotation proposée ne couvre pas exactement les 8 écritures de l''exercice 2024.'],
    array['controlef', '166c. … la seconde occurrence à la place d''une autre ligne, le compte des lignes reçues juste', 'chef', $q${VAL}'{K}', 2024, jsonb_set({JK}, '{1}', jsonb_set(jsonb_set({JK} -> 0, '{numero}', '2'), '{mode_reglement}', '"Espèces"')){FIN}$q$, '22023',
      'La numérotation proposée ne couvre pas exactement les 8 écritures de l''exercice 2024.'],
    -- La validation qui les porte, et les fige.
    array['faitf', '170. le chef valide 2024 de K, et ses quatre champs', 'chef', $q${VAL}'{K}', 2024, {JK}{FIN}$q$, 'OK', ''],
    array['valeurf', '171. ils sont figés, ligne par ligne, tels que la numérotation les portait', 'postgres', $q$select string_agg(coalesce(to_char(date_reglement, 'YYYY-MM-DD'), '∅') || '|' || coalesce(mode_reglement, '∅') || '|' || coalesce(nature_operation, '∅') || '|' || coalesce(poste_rattache, '∅') || '|' || coalesce(identification_client, '∅'), ',' order by id) from ecritures_brouillon where dossier_id = '{K}' and statut = 'validee'$q$, '',
      '2024-03-05|Banque|Dépense|Achats|∅,2024-03-05|Banque|Dépense|∅|∅,2024-05-10|Banque|Recette|∅|999000102,2024-05-10|Banque|Recette|Recettes|999000102,2024-06-01|Banque|Recette|∅|A2024-0001,2024-06-01|Banque|Recette|Gains divers|A2024-0001,∅|∅|Dotation aux amortissements|Amortissements|∅,∅|∅|Dotation aux amortissements|∅|∅'],
    array['valeurf', '172. LE CAS NEUTRE : les écritures de A, validées sans les clés, n''en portent aucun', 'postgres', $q$select count(*) filter (where num_nonnulls(date_reglement, mode_reglement, nature_operation, poste_rattache, identification_client) > 0) || '/' || count(*) from ecritures_brouillon where dossier_id = '{A}' and statut = 'validee'$q$, '', '0/17'],
    array['valeurf', '173. l''empreinte de K se vérifie', 'postgres', $q$select verifier_exercice_valide('{K}', 2024)::text$q$, '', 'true'],
    array['valeurf', '173b. … et compte les quatre champs : ce n''est pas l''empreinte d''hier', 'postgres', format($q$select ((select empreinte from exercices_valides where dossier_id = '{K}' and annee = 2024) <> (%s))::text$q$, format(empreinte_d_hier, '{K}', 2024, null)), '', 'true'],
    array['valeurf', '173c. l''empreinte d''un exercice validé sans eux est celle d''hier, au caractère près (A, et G et son ouverture)', 'postgres', format($q$select (empreinte_exercice('{A}', 2024, null) = (%s))::text || '/' || (empreinte_exercice('{G}', 2025, null) = (%s))::text$q$, format(empreinte_d_hier, '{A}', 2024, null), format(empreinte_d_hier, '{G}', 2025, null)), '', 'true/true'],
    array['controlef', '174. un champ figé ne change plus, même pour le propriétaire de la base', 'postgres', $q$update ecritures_brouillon set mode_reglement = 'Chèque' where id = '{EK2}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controlef', '174b. … ni pour le chef, qui voudrait taire une identification', 'chef', $q$update ecritures_brouillon set identification_client = null where id = '{EK3}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    -- Chaque champ, l'un après l'autre, falsifié hors déclencheur puis rétabli : une empreinte qui en oublierait un ne le
    -- verrait pas.
    array['jeuf', 'falsifier chaque champ hors déclencheur, l''un après l''autre, puis le rétablir', 'postgres', $q$do $f$
      declare
        c record;
        r text := '';
      begin
        set local session_replication_role = replica;
        for c in select * from (values
            (1, 'date_reglement', '{EK1}', '2024-03-04', '2024-03-05'),
            (2, 'mode_reglement', '{EK2}', 'Chèque', 'Banque'),
            (3, 'nature_operation', '{EK3}', 'Recette et dépense', 'Recette'),
            (4, 'poste_rattache', '{EK4}', 'Gains divers', 'Recettes'),
            (5, 'identification_client', '{EK5}', 'F2024-0001', 'A2024-0001')) as v(rang, colonne, ligne, faux, juste)
          order by rang loop
          execute format('update ecritures_brouillon set %I = %L where id = %L', c.colonne, c.faux, c.ligne);
          r := r || c.colonne || ':' || verifier_exercice_valide('{K}', 2024)::text || ',';
          execute format('update ecritures_brouillon set %I = %L where id = %L', c.colonne, c.juste, c.ligne);
        end loop;
        set local session_replication_role = origin;
        perform set_config('essai.falsifications', r || 'rétablis:' || verifier_exercice_valide('{K}', 2024)::text, true);
      end
    $f$$q$, '', ''],
    array['valeurf', '175. chaque champ falsifié hors déclencheur se voit ; rétablis, ils se relisent', 'postgres', $q$select current_setting('essai.falsifications')$q$, '',
      'date_reglement:false,mode_reglement:false,nature_operation:false,poste_rattache:false,identification_client:false,rétablis:true'],
    -- La dotation ne porte que sa nature : passée dans l'identification, la ligne garderait, sans le rang de chaque champ,
    -- le même texte.
    array['jeuf', 'passer la nature d''une ligne dans son identification, hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeuf', '', 'postgres', $q$update ecritures_brouillon set nature_operation = null, identification_client = 'Dotation aux amortissements' where id = '{EK8}'$q$, '', ''],
    array['jeuf', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeurf', '176. une valeur passée d''un champ à l''autre se voit', 'postgres', $q$select verifier_exercice_valide('{K}', 2024)::text$q$, '', 'false'],
    array['jeuf', 'la rendre à sa place', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeuf', '', 'postgres', $q$update ecritures_brouillon set nature_operation = 'Dotation aux amortissements', identification_client = null where id = '{EK8}'$q$, '', ''],
    array['jeuf', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeurf', '176b. rendue, elle se relit', 'postgres', $q$select verifier_exercice_valide('{K}', 2024)::text$q$, '', 'true'],
    -- La contrainte, sans la fonction : une écriture proposée n'en porte aucun ; la restauration réinsère ce qui a été
    -- validé, dans les listes.
    array['controlef', '180. une écriture proposée ne porte aucun des quatre champs', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, mode_reglement) values ('{X}', '2024-08-01', '606100', 'ESSAI X', 1, 'debit', 'Banque')$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '180b. … ni ne les reçoit par une mise à jour', 'chef', $q$update ecritures_brouillon set nature_operation = 'Dépense' where id = '{XE24}'$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['faitf', '181. la restauration réinsère des écritures validées et leurs champs', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib, date_reglement, mode_reglement, nature_operation, poste_rattache, identification_client) values
      ('{RF1}', '{RF}', '2024-04-02', '606100', 'ESSAI RF', 10, 'debit', 'validee', '2025-02-01 10:00+00', 'AC', 1, 'Pièce RF', '2024-04-01', 'Achats', '2024-04-02', 'Chèque', 'Dépense', 'Achats', null),
      ('{RF2}', '{RF}', '2024-04-02', '512000', 'ESSAI RF', 10, 'credit', 'validee', '2025-02-01 10:00+00', 'AC', 1, 'Pièce RF', '2024-04-01', 'Banque', '2024-04-02', 'Chèque', 'Dépense', null, null)$q$, 'OK', ''],
    array['valeurf', '181b. … tels quels', 'postgres', $q$select string_agg(compte || '|' || to_char(date_reglement, 'YYYY-MM-DD') || '|' || mode_reglement || '|' || nature_operation || '|' || coalesce(poste_rattache, '∅'), ',' order by id) from ecritures_brouillon where dossier_id = '{RF}'$q$, '',
      '606100|2024-04-02|Chèque|Dépense|Achats,512000|2024-04-02|Chèque|Dépense|∅'],
    array['controlef', '182. … mais pas un mode hors de sa liste', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', '2024-04-03', 'Cheque', 'Dépense', null, null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182b. … ni une nature hors de la sienne', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, 'Soins infirmiers', null, null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182c. … ni un poste sur un compte de bilan', 'chef', $q${RES}'{RF}', '2024-04-03', '512000', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Banque', null, null, 'Dépense', 'Achats', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182d. … ni un poste de recettes sur une charge', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, 'Dépense', 'Recettes', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182d2. … ni des honoraires rétrocédés sur un produit', 'chef', $q${RES}'{RF}', '2024-04-03', '706000', 'ESSAI', 1, 'credit', 'validee', now(), 'VE', 2, 'x', '2024-04-03', 'Honoraires', null, null, 'Recette', 'Honoraires rétrocédés', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182d3. MUTATION de 182d2 : sur une charge, ils se réinsèrent', 'chef', $q${RES}'{RF}', '2024-04-03', '622600', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Rétrocessions', null, null, 'Dépense', 'Honoraires rétrocédés', null)$q$, 'OK', ''],
    -- Les quatre postes de l'étape 2035S1, par la même porte : réinsérés sur un compte de leur classe, refusés sur l'autre.
    array['controlef', '182i. … ni des indemnités journalières sur une charge', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, 'Dépense', 'Indemnités journalières', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182j. MUTATION de 182i : sur un produit, elles se réinsèrent', 'chef', $q${RES}'{RF}', '2024-04-03', '791000', 'ESSAI', 1, 'credit', 'validee', now(), 'VE', 2, 'x', '2024-04-03', 'Indemnités journalières', null, null, 'Recette', 'Indemnités journalières', null)$q$, 'OK', ''],
    array['controlef', '182k. … ni des redevances de collaboration sur un produit', 'chef', $q${RES}'{RF}', '2024-04-03', '706000', 'ESSAI', 1, 'credit', 'validee', now(), 'VE', 2, 'x', '2024-04-03', 'Honoraires', null, null, 'Recette', 'Redevances de collaboration', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182l. MUTATION de 182k : sur une charge, elles se réinsèrent', 'chef', $q${RES}'{RF}', '2024-04-03', '613500', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Redevances de collaboration', null, null, 'Dépense', 'Redevances de collaboration', null)$q$, 'OK', ''],
    array['controlef', '182m. … ni des cotisations facultatives Madelin sur un produit', 'chef', $q${RES}'{RF}', '2024-04-03', '706000', 'ESSAI', 1, 'credit', 'validee', now(), 'VE', 2, 'x', '2024-04-03', 'Honoraires', null, null, 'Recette', 'Cotisations facultatives Madelin', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182n. MUTATION de 182m : sur une charge, elles se réinsèrent', 'chef', $q${RES}'{RF}', '2024-04-03', '646100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Cotisations facultatives', null, null, 'Dépense', 'Cotisations facultatives Madelin', null)$q$, 'OK', ''],
    array['controlef', '182o. … ni un plan d''épargne retraite sur un produit', 'chef', $q${RES}'{RF}', '2024-04-03', '706000', 'ESSAI', 1, 'credit', 'validee', now(), 'VE', 2, 'x', '2024-04-03', 'Honoraires', null, null, 'Recette', 'Plan d''épargne retraite', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182p. MUTATION de 182o : sur une charge, il se réinsère', 'chef', $q${RES}'{RF}', '2024-04-03', '646100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Plan d''épargne retraite', null, null, 'Dépense', 'Plan d''épargne retraite', null)$q$, 'OK', ''],
    array['controlef', '182e. … ni un poste sans nature', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, null, 'Achats', null)$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182f. … ni une identification bordée d''un blanc', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, null, null, ' F2024-0001')$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182g. … ni une identification qui porte un caractère de contrôle', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, null, null, 'F2024' || chr(10) || '0001')$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '182h. … ni une identification vide', 'chef', $q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', null, null, null, null, '')$q$, '23514',
      'new row for relation "ecritures_brouillon" violates check constraint "ecritures_brouillon_champs_bnc_du_fec"%'],
    array['controlef', '183. ce que la contrainte ne juge pas : le jour, que la validation seule refuse', 'chef', format($q${RES}'{RF}', '2024-04-03', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'AC', 2, 'x', '2024-04-03', 'Achats', '%s', null, null, null, null)$q$, to_char(aujourd_hui + 2, 'YYYY-MM-DD')), 'OK', ''],
    -- Le catalogue.
    array['valeurf', '190. cinq colonnes nulles, sans valeur par défaut', 'postgres', $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '∅'), ',' order by a.attname collate "C") from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.ecritures_brouillon'::regclass and not a.attisdropped and a.attname in ('date_reglement', 'mode_reglement', 'nature_operation', 'poste_rattache', 'identification_client')$q$, '',
      'date_reglement:date:false:∅,identification_client:text:false:∅,mode_reglement:text:false:∅,nature_operation:text:false:∅,poste_rattache:text:false:∅'],
    array['valeurf', '190b. et la contrainte, validée, à côté de celle d''hier, inchangée (sa définition à l''empreinte d''hier)', 'postgres', $q$select string_agg(conname || ':' || contype::text || ':' || convalidated || case when conname = 'ecritures_brouillon_validation_complete' then ':' || md5(pg_get_constraintdef(oid)) else '' end, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass and conname in ('ecritures_brouillon_champs_bnc_du_fec', 'ecritures_brouillon_validation_complete')$q$, '',
      'ecritures_brouillon_champs_bnc_du_fec:c:true,ecritures_brouillon_validation_complete:c:true:ea2ab25ce87ce97ced803e6e304b7b0f']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      -- Une étape du lot FEC22b (genre « …f ») ne se joue qu'avec la migration champs_bnc_du_fec ; sans elle, elle attend.
      genre := etape[1];
      if genre like '%f' then
        if not fec then
          en_attente_fec := en_attente_fec + 1;
          continue;
        end if;
        genre := left(genre, -1);
      end if;
      s := etape[4];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
        s := replace(s, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if genre = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif genre = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = etape[6], false));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
          end if;
          execute s;
          accepte := true;
          if genre = 'controle' then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        verdicts := verdicts || jsonb_build_object('controle', etape[2],
          'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', case when etape[5] = 'OK' then accepte and (genre = 'fait' or coalesce(code_recu = 'P0001', false))
                     else not accepte and coalesce(code_recu = etape[5] and message like etape[6], false) end);
      end if;
    end loop;
    if en_attente_fec > 0 then
      verdicts := verdicts || jsonb_build_object('controle', '150. EN ATTENTE de la migration champs_bnc_du_fec (lot FEC22b) : '
        || en_attente_fec || ' étapes — les quatre champs du FEC d''un BNC en trésorerie', 'observe',
        'absente : elles se jouent dès qu''elle y est', 'ok', true);
    end if;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le déroulé de l''essai', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ══ 145. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from pieces)), ((select count(*) from lignes_bancaires)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from immobilisations)), ((select count(*) from vehicules)), ((select count(*) from cotisations_declarees)),
    ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)), ((select count(*) from dossier_assignations)),
    ((select count(*) from soldes_reportes)), ((select count(*) from factures_emises))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '145. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)),
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VALIDATION%')
      and not exists (select 1 from cabinet_admins where user_id = client)
      and current_setting('session_replication_role') = 'origin');

  perform set_config('essai.validation', verdicts::text, true);
end $essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.validation')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
