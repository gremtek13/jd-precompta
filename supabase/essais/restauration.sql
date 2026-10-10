-- Essai de restauration — à rejouer, pas à lire.
--
-- Une sauvegarde jamais restaurée n'est pas une sauvegarde, et un essai fait une fois ne prouve rien
-- du mois suivant. Les tests Vitest rejouent l'ORDRE et les CONTRÔLES à chaque exécution de la suite,
-- mais ils ne peuvent pas rejouer Postgres : ni les clés étrangères, ni les CHECK, ni le refus d'un
-- lien vers une ligne absente. C'est ce que fait ce script.
--
-- Il ne touche à rien : il fabrique un schéma jetable qui porte les VRAIES contraintes (copiées de
-- `public` par pg_get_constraintdef), y restaure un dossier table par table dans l'ordre de
-- ORDRE_RESTAURATION, compare le résultat à la source par empreinte de contenu, puis se supprime.
--
-- LE PLAN EST CELUI DE `src/lib/sauvegarde.ts`, recopié et non résumé : l'ordre (`_ordre`), le chemin
-- de chaque table (`_chemins`) et les liens auto-référencés restaurés par vagues (`_vagues`).
-- `src/lib/restaurationEssai.test.ts` les confronte au code à chaque exécution de la suite : si les
-- deux divergent, c'est l'essai qui ment — c'est le code qui restaure en production.
--
-- LES VAGUES. Une ligne d'une table de `_vagues` part quand chacun de ses liens est vide, pointe hors du
-- dossier ou pointe une ligne déjà écrite — une instruction par vague, comme `planReinsertion`. Postgres
-- vérifie une clé étrangère à la fin de chaque instruction : une vague qui écrirait une ligne avant celle
-- qu'elle désigne échoue ici. Ce que l'essai ne voit PAS : tout écrire en une seule instruction, que
-- Postgres accepte, mais que les gardes de la révision et des encaissements refuseraient (l'ordre des
-- lignes à l'intérieur d'une instruction n'est pas garanti) — `sauvegardeDonnees.test.ts` et les essais
-- de ces mécanismes le gardent. L'avoir et sa facture d'origine gardent leurs deux passes.
--
-- OÙ IL SE JOUE : sur une réplique locale du schéma (HISTORIQUE.md, « LA RÉPLIQUE : LE PROCÉDÉ »), par
-- psql, sur un dossier qu'on y a semé. Il crée et supprime un schéma : l'outil d'exécution de la
-- production soumet une suppression à une confirmation qui n'arrive pas, et un schéma jetable qui
-- recopie les données d'un dossier n'a rien à faire dans la base du cabinet.
--
-- Ce qu'il NE prouve PAS, et qu'il faut savoir :
--   - Rien sur les comptes utilisateurs. Les clés étrangères vers `auth.users` sont volontairement
--     exclues, comme dans RELATIONS. Or quatre colonnes du plan sont NOT NULL vers cette table
--     (dossier_assignations.user_id, memberships.user_id, packs.generated_by, et cabinet_admins
--     hors plan) : sans les comptes, une vraie restauration s'arrête là, et aucun essai de ce
--     script ne le montrera. Voir PREREQUIS_AUTH.
--   - Rien sur les fichiers du stockage, qui ne sont pas des lignes de base.
--   - Rien sur les policies RLS : ce script tourne en propriétaire.
--   - Rien sur les DÉCLENCHEURS, que la copie d'une table n'emporte pas : ce que les gardes refusent
--     à la restauration — une décision de la révision avant sa cible, une preuve avant sa source, un
--     exercice validé posé trop tôt — est éprouvé par les essais de leur mécanisme (revisionSoldes.sql,
--     encaissementsFactures.sql, validationExercice.sql) et par `sauvegardeDonnees.test.ts`.
--
-- Passage du 18/09/2026, en production par `execute_sql`, section par section (40 tables), dossier
-- 001c7ed7-c23b-4590-901e-693489f8af24 :
--   40 tables recréées, 57 clés étrangères, 35 tables restaurées et IDENTIQUES à la source
--   (empreinte du contenu, pas seulement le compte), 0 écart, 4 contrôles de liens intacts
--   (10 mouvements rapprochés, 41 pièces en sous-dossier, 3 pièces catégorisées, 41 textes OCR).
--
-- Passage du 09/10/2026, sur la réplique locale de l'étape R1 de la ligne 41 (signature.sql : les neuf
-- familles égales à la production, migration `revision_des_soldes` comprise), le dossier `test` de la
-- réplique semé de deux pièces, un document, quatre écritures, l'exercice 2024 validé et cinq décisions de
-- la révision — une chaîne de trois sur 2024 et 2025, une reprise, quatre preuves — par les fonctions
-- de la base : 58 tables recréées, 53 restaurées et IDENTIQUES à la source (20 lignes), les décisions en
-- quatre vagues, 0 écart, aucun arrêt.
--
-- 09/10/2026, espace client P0 : `notes_internes` entre au plan (59 tables), après les pièces et les documents
-- qu'elle annote. Le script n'a PAS été rejoué depuis — aucune réplique complète n'était montée ; ce que la
-- restauration fait des anciennes colonnes des notes (`sansAnciennesNotes`, en TypeScript) n'est pas de son ressort :
-- il recopie des lignes, il ne les transforme pas.
--
-- 10/10/2026, ligne 28.5, étape e2 : `pieces_hors_de_france` et `pieces_hors_de_france_taux` entrent au plan (61 tables),
-- après les notes internes et avant le brouillon, les versions de la fiche par vagues (`remplace_id`). Rejoué sur la
-- réplique locale de l'étape (signature.sql : les neuf familles égales à la production, hors des objets de deux
-- migrations d'autres chantiers), le dossier `test` semé par les fonctions de la base — trois pièces, cinq fiches dont
-- une chaîne de trois versions et deux retirées, six lignes de ventilation : 61 tables recréées, 56 restaurées et
-- IDENTIQUES à la source (15 lignes), les fiches en trois vagues, 0 écart, aucun arrêt. Planté — la ventilation avant
-- sa fiche —, le script s'arrête sur la clé.
--
-- 10/10/2026, ligne 43, étape PC1 : le catalogue des rôles comptables entre à l'ordre (rang 4, référentiel `global` que
-- la base d'arrivée doit porter, comme le cabinet : il est recopié ci-dessous en prérequis) et le plan d'un dossier juste
-- après son dossier (61 tables) ; le contrôle du point NON VÉRIFIÉ 7 suit le verdict. Rejoué sur la réplique locale de
-- l'étape (signature.sql : les neuf familles égales à la production, migration `plan_comptable_des_dossiers` comprise),
-- dans une transaction annulée, le dossier `test` semé du plan fictif décalé — 26 rôles, posés par la seule porte
-- ouverte, le propriétaire sous la session du super-administrateur — puis de deux écritures ; la réplique portant, comme
-- la production, les deux tables de l'étape e2, le script joué leur ajoutait leurs lignes de l'ordre, des chemins et des
-- vagues telles que le correctif d'e2 les écrit : 63 tables recréées, 57 restaurées et IDENTIQUES à la source (29
-- lignes, dont les 26 du plan au rang 7), 0 écart, aucun arrêt ; un rôle inconnu de la base d'arrivée refusé par la clé
-- (23503), la même ligne acceptée une fois le rôle inscrit. Plantés — le catalogue absent de la base d'arrivée, puis le
-- plan avant son dossier —, le script s'arrête sur la clé du plan. Ce que la garde exige à la restauration (le
-- super-administrateur, un dossier encore sans écriture) n'est pas de son ressort : `planComptable.sql`.

-- ══ 1. Le schéma d'essai ══════════════════════════════════════════════════════════════════════════
drop schema if exists essai_restauration cascade;
create schema essai_restauration;

create table essai_restauration._ordre (rang int primary key, table_nom text not null);
create table essai_restauration._chemins (table_nom text primary key, acces text not null, parent text, colonne text);
create table essai_restauration._vagues (table_nom text not null, colonne text not null);

-- Recopiés de src/lib/sauvegarde.ts (ORDRE_RESTAURATION, CHEMINS_DOSSIER, TABLES_AUTO_REFERENCEES_PAR_VAGUES).
insert into essai_restauration._ordre (rang, table_nom) values
 (1,'cabinets'),(2,'super_admins'),(3,'taux_change_bce'),(4,'roles_comptables'),(5,'cabinet_admins'),
 (6,'dossiers'),(7,'plan_comptable_dossier'),(8,'a_nouveaux'),(9,'agent_conversations'),(10,'categories'),
 (11,'comptes_courants_associes'),(12,'connexions_bancaires'),(13,'connexions_plateformes'),(14,'controles_releves_bancaires'),(15,'cotisations_declarees'),
 (16,'declarations_tva'),(17,'dossier_assignations'),(18,'emprunts'),(19,'exercices_clotures'),(20,'facture_numerotation'),
 (21,'factures_emises'),(22,'informations_dossier'),(23,'memberships'),(24,'natures_immobilisation'),(25,'packs'),
 (26,'previsionnels_bancaires'),(27,'references_annuelles'),(28,'references_postes_annuels'),(29,'regles_bancaires_ignorees'),(30,'soldes_reportes'),
 (31,'sous_dossiers'),(32,'superpdp_credentials'),(33,'vehicules'),(34,'volet_social_pamc'),(35,'documents_divers'),
 (36,'emails_envoyes'),(37,'facture_lignes'),(38,'facture_superpdp_events'),(39,'statuts_factures_recus'),(40,'transmissions_factures'),
 (41,'mouvements_cca'),(42,'pieces'),(43,'supplements'),(44,'regles_affectation_bancaire'),(45,'tiers_categories'),
 (46,'tiers_categories_cabinet'),(47,'immobilisations'),(48,'lignes_bancaires'),(49,'ventilations_bancaires'),(50,'reglements_groupes'),
 (51,'encaissements_factures'),(52,'encaissements_factures_taux'),(53,'transmissions_encaissements'),(54,'lettrages_manuels'),(55,'piece_commentaires'),
 (56,'piece_textes_ocr'),(57,'notes_internes'),(58,'pieces_hors_de_france'),(59,'pieces_hors_de_france_taux'),(60,'ecritures_brouillon'),
 (61,'revision_justifications'),(62,'revision_preuves'),(63,'exercices_valides');

insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
 ('a_nouveaux','direct',null,null),('agent_conversations','direct',null,null),('cabinet_admins','cabinet',null,null),
 ('cabinets','global',null,null),('categories','partage',null,null),('comptes_courants_associes','direct',null,null),
 ('connexions_bancaires','direct',null,null),('connexions_plateformes','direct',null,null),('controles_releves_bancaires','direct',null,null),
 ('cotisations_declarees','direct',null,null),('declarations_tva','direct',null,null),('documents_divers','direct',null,null),
 ('dossier_assignations','direct',null,null),('dossiers','le_dossier',null,null),('ecritures_brouillon','direct',null,null),
 ('emails_envoyes','direct',null,null),('emprunts','direct',null,null),('encaissements_factures','direct',null,null),
 ('encaissements_factures_taux','direct',null,null),('exercices_clotures','direct',null,null),('exercices_valides','direct',null,null),
 ('facture_lignes','par_parent','factures_emises','facture_id'),('facture_numerotation','direct',null,null),('facture_superpdp_events','direct',null,null),
 ('factures_emises','direct',null,null),('immobilisations','direct',null,null),('informations_dossier','direct',null,null),
 ('lettrages_manuels','direct',null,null),('lignes_bancaires','direct',null,null),('memberships','direct',null,null),
 ('mouvements_cca','par_parent','comptes_courants_associes','compte_id'),('natures_immobilisation','partage',null,null),('notes_internes','direct',null,null),
 ('packs','direct',null,null),
 ('piece_commentaires','direct',null,null),('piece_textes_ocr','direct',null,null),('pieces','direct',null,null),
 ('pieces_hors_de_france','direct',null,null),('pieces_hors_de_france_taux','direct',null,null),
 ('plan_comptable_dossier','direct',null,null),
 ('previsionnels_bancaires','direct',null,null),('references_annuelles','direct',null,null),('references_postes_annuels','direct',null,null),
 ('reglements_groupes','direct',null,null),('regles_affectation_bancaire','direct',null,null),('regles_bancaires_ignorees','direct',null,null),
 ('revision_justifications','direct',null,null),('revision_preuves','direct',null,null),('roles_comptables','global',null,null),
 ('soldes_reportes','direct',null,null),
 ('sous_dossiers','direct',null,null),('statuts_factures_recus','direct',null,null),('super_admins','global',null,null),
 ('superpdp_credentials','direct',null,null),('supplements','direct',null,null),('taux_change_bce','global',null,null),
 ('tiers_categories','direct',null,null),('tiers_categories_cabinet','cabinet',null,null),('transmissions_encaissements','direct',null,null),
 ('transmissions_factures','direct',null,null),('vehicules','direct',null,null),('ventilations_bancaires','direct',null,null),
 ('volet_social_pamc','direct',null,null);

insert into essai_restauration._vagues (table_nom, colonne) values
 ('encaissements_factures','annule_id'),('revision_justifications','remplace_id'),('revision_justifications','reprise_de'),
 ('pieces_hors_de_france','remplace_id');

do $$
declare t text;
begin
  for t in select table_nom from essai_restauration._ordre order by rang loop
    execute format('create table essai_restauration.%I (like public.%I including defaults including constraints including indexes)', t, t);
  end loop;
end $$;

-- Les clés étrangères telles que Postgres les déclare, redirigées vers le schéma d'essai. Seules
-- celles entre tables de `public` — voir l'en-tête pour ce que cette exclusion coûte.
do $$
declare r record;
begin
  for r in
    select c.conname, te.relname as enfant, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class te on te.oid = c.conrelid
    join pg_namespace ne on ne.oid = te.relnamespace
    join pg_class tp on tp.oid = c.confrelid
    join pg_namespace np on np.oid = tp.relnamespace
    where c.contype = 'f' and ne.nspname = 'public' and np.nspname = 'public'
  loop
    execute format('alter table essai_restauration.%I add constraint %I %s',
      r.enfant, r.conname, replace(r.def, 'REFERENCES ', 'REFERENCES essai_restauration.'));
  end loop;
end $$;

-- ══ 2. La restauration ════════════════════════════════════════════════════════════════════════════
-- Remplacer l'identifiant ci-dessous par le dossier à éprouver.
create table essai_restauration._verdict (etape text, detail text);
create table essai_restauration._cible (dossier uuid primary key);
insert into essai_restauration._cible values ('001c7ed7-c23b-4590-901e-693489f8af24');

-- Les prérequis que la sauvegarde ne contient pas (voir referencesExternes) : le cabinet du dossier, et le catalogue des
-- rôles comptables, qu'une migration pose dans toute base d'arrivée (`PARENTS_HORS_PLAN_VOULUS`, ligne 43, PC1).
insert into essai_restauration.cabinets
  select * from public.cabinets
  where id = (select cabinet_id from public.dossiers where id = (select dossier from essai_restauration._cible));
insert into essai_restauration.roles_comptables select * from public.roles_comptables;

do $$
declare d uuid := (select dossier from essai_restauration._cible); r record; n bigint; ecrits bigint; vagues int; condition text;
begin
  for r in
    select o.rang, o.table_nom, c.acces, c.parent, c.colonne
    from essai_restauration._ordre o join essai_restauration._chemins c on c.table_nom = o.table_nom
    order by o.rang
  loop
    if r.acces in ('global','cabinet') then continue; end if;
    vagues := 0;

    if r.acces = 'le_dossier' then
      execute format('insert into essai_restauration.%I select * from public.%I where id = $1', r.table_nom, r.table_nom) using d;
    elsif r.acces = 'direct' and exists (select 1 from essai_restauration._vagues v where v.table_nom = r.table_nom) then
      -- Par vagues (TABLES_AUTO_REFERENCEES_PAR_VAGUES) : une ligne part quand chacun de ses liens est vide, pointe hors
      -- de la sauvegarde ou pointe une ligne déjà écrite — une écriture par vague. Ce qui ne peut plus avancer (un cycle)
      -- part en dernier, et c'est Postgres qui dira non.
      select string_agg(format('(s.%1$I is null or s.%1$I not in (select x.id from public.%2$I x where x.dossier_id = $1)'
                               || ' or s.%1$I in (select y.id from essai_restauration.%2$I y))', v.colonne, r.table_nom), ' and ')
        into condition from essai_restauration._vagues v where v.table_nom = r.table_nom;
      loop
        execute format('insert into essai_restauration.%I select s.* from public.%I s where s.dossier_id = $1'
                       || ' and s.id not in (select z.id from essai_restauration.%I z) and %s', r.table_nom, r.table_nom, r.table_nom, condition)
          using d;
        get diagnostics ecrits = row_count;
        exit when ecrits = 0;
        vagues := vagues + 1;
      end loop;
      execute format('insert into essai_restauration.%I select s.* from public.%I s where s.dossier_id = $1'
                     || ' and s.id not in (select z.id from essai_restauration.%I z)', r.table_nom, r.table_nom, r.table_nom)
        using d;
    elsif r.acces = 'direct' then
      if r.table_nom = 'factures_emises' then
        -- Première des deux passes : le lien auto-référencé part vide (voir TABLES_AUTO_REFERENCEES).
        insert into essai_restauration.factures_emises
          select (f).* from (select f from public.factures_emises f where f.dossier_id = d) s(f);
        update essai_restauration.factures_emises set facture_origine_id = null;
      else
        execute format('insert into essai_restauration.%I select * from public.%I where dossier_id = $1', r.table_nom, r.table_nom) using d;
      end if;
    elsif r.acces = 'partage' then
      execute format('insert into essai_restauration.%I select * from public.%I where dossier_id = $1 or dossier_id is null', r.table_nom, r.table_nom) using d;
    elsif r.acces = 'par_parent' then
      execute format('insert into essai_restauration.%I select * from public.%I where %I in (select id from essai_restauration.%I)',
        r.table_nom, r.table_nom, r.colonne, r.parent);
    end if;

    execute format('select count(*) from essai_restauration.%I', r.table_nom) into n;
    insert into essai_restauration._verdict values (lpad(r.rang::text,2,'0') || ' ' || r.table_nom,
      n || ' lignes (' || r.acces || case when vagues > 0 then ', ' || vagues || ' vague(s)' else '' end || ')');
  end loop;
exception when others then
  insert into essai_restauration._verdict values ('ARRET', 'sur ' || r.table_nom || ' : ' || sqlerrm);
end $$;

-- Seconde passe : les liens auto-référencés, une fois toutes les lignes en place.
update essai_restauration.factures_emises e
   set facture_origine_id = p.facture_origine_id
  from public.factures_emises p
 where p.id = e.id and p.facture_origine_id is not null;

select etape, detail from essai_restauration._verdict order by etape;

-- ══ 3. Le verdict ═════════════════════════════════════════════════════════════════════════════════
-- Le compte de lignes ne suffit pas : on compare le CONTENU, par empreinte de la table entière triée.
create table essai_restauration._egalite (table_nom text, nb_essai bigint, nb_source bigint, verdict text);
do $$
declare d uuid := (select dossier from essai_restauration._cible); r record; ne bigint; ns bigint; ee text; es text; filtre text;
begin
  for r in
    select o.rang, o.table_nom, c.acces, c.parent, c.colonne
    from essai_restauration._ordre o join essai_restauration._chemins c on c.table_nom = o.table_nom
    where c.acces not in ('global','cabinet') order by o.rang
  loop
    filtre := case r.acces
      when 'le_dossier' then format('id = %L', d)
      when 'direct' then format('dossier_id = %L', d)
      when 'partage' then format('(dossier_id = %L or dossier_id is null)', d)
      when 'par_parent' then format('%I in (select id from essai_restauration.%I)', r.colonne, r.parent)
    end;
    execute format('select count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from essai_restauration.%I t', '|', '', r.table_nom) into ne, ee;
    execute format('select count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from public.%I t where %s', '|', '', r.table_nom, filtre) into ns, es;
    insert into essai_restauration._egalite values (r.table_nom, ne, ns, case when ne = ns and ee = es then 'IDENTIQUE' else 'ECART' end);
  end loop;
end $$;

select verdict, count(*) as tables, sum(nb_essai) as lignes, string_agg(table_nom || ' (' || nb_essai || ')', ', ' order by table_nom) as lesquelles
from essai_restauration._egalite group by verdict order by verdict;

-- Le point NON VÉRIFIÉ 7 de la conception du plan comptable (ligne 43, PC1) : une sauvegarde dont le plan désigne un rôle
-- que la base d'arrivée ne connaît pas — une base plus ancienne que celle qui l'a écrite. La clé étrangère vers le
-- catalogue le refuse (23503) ; `restaurerSauvegarde` le refuse AVANT d'écrire, en lisant les rôles dans la base
-- d'arrivée (`referencesExternes`). Et la même ligne passe dès que le catalogue connaît son rôle : le refus est celui de
-- la clé, pas d'autre chose. Chaque essai s'annule (`ANNULATION_ESSAI`) : le contenu comparé ci-dessus reste celui de la
-- restauration.
create table essai_restauration._controles (controle text, attendu text, observe text);
do $$
declare d uuid := (select dossier from essai_restauration._cible); code text; inscrit boolean;
begin
  foreach inscrit in array array[false, true] loop
    code := null;
    begin
      if inscrit then
        insert into essai_restauration.roles_comptables (role, racines, compte_defaut, libelle_defaut, ordre)
        values ('role_d_une_base_plus_recente', '{512}', '512900', 'Essai', 999);
      end if;
      insert into essai_restauration.plan_comptable_dossier (dossier_id, role, compte)
      values (d, 'role_d_une_base_plus_recente', '512100');
      code := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if code is null then code := sqlstate; end if;
    end;
    insert into essai_restauration._controles values (
      case when inscrit then 'le même rôle, une fois inscrit au catalogue de la base d''arrivée'
           else 'un rôle que la base d''arrivée ne connaît pas' end,
      case when inscrit then 'ACCEPTÉ' else '23503' end, coalesce(code, '?'));
  end loop;
end $$;

select controle, attendu, observe, observe = attendu as ok from essai_restauration._controles order by controle;

-- ══ 4. Nettoyage ══════════════════════════════════════════════════════════════════════════════════
-- Le schéma d'essai contient de vraies données comptables : ne pas le laisser traîner.
drop schema if exists essai_restauration cascade;
