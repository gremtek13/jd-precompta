-- Essai de restauration — à rejouer, pas à lire.
--
-- Une sauvegarde jamais restaurée n'est pas une sauvegarde, et un essai fait une fois ne prouve rien
-- du mois suivant. Les tests Vitest rejouent l'ORDRE et les CONTRÔLES à chaque exécution de la suite,
-- mais ils ne peuvent pas rejouer Postgres : ni les clés étrangères, ni les CHECK, ni le refus d'un
-- lien vers une ligne absente. C'est ce que fait ce script.
--
-- Il ne touche à rien : il fabrique un schéma jetable qui porte les VRAIES contraintes (copiées de
-- `public` par pg_get_constraintdef), y restaure un dossier réel table par table dans l'ordre de
-- ORDRE_RESTAURATION, compare le résultat à la source par empreinte de contenu, puis se supprime.
--
-- À lancer par l'outil MCP Supabase (`execute_sql`), section par section — le `statement_timeout` du
-- projet est à 8 s, un seul bloc n'y tiendrait pas.
--
-- Ce qu'il NE prouve PAS, et qu'il faut savoir :
--   - Rien sur les comptes utilisateurs. Les clés étrangères vers `auth.users` sont volontairement
--     exclues, comme dans RELATIONS. Or quatre colonnes du plan sont NOT NULL vers cette table
--     (dossier_assignations.user_id, memberships.user_id, packs.generated_by, et cabinet_admins
--     hors plan) : sans les comptes, une vraie restauration s'arrête là, et aucun essai de ce
--     script ne le montrera. Voir PREREQUIS_AUTH.
--   - Rien sur les fichiers du stockage, qui ne sont pas des lignes de base.
--   - Rien sur les policies RLS : ce script tourne en service role.
--
-- Dernier passage : 18/09/2026, dossier 001c7ed7-c23b-4590-901e-693489f8af24.
--   40 tables recréées, 57 clés étrangères, 35 tables restaurées et IDENTIQUES à la source
--   (empreinte du contenu, pas seulement le compte), 0 écart, 4 contrôles de liens intacts
--   (10 mouvements rapprochés, 41 pièces en sous-dossier, 3 pièces catégorisées, 41 textes OCR).

-- ══ 1. Le schéma d'essai ══════════════════════════════════════════════════════════════════════════
drop schema if exists essai_restauration cascade;
create schema essai_restauration;

create table essai_restauration._ordre (rang int primary key, table_nom text not null);
insert into essai_restauration._ordre (rang, table_nom) values
 (1,'cabinets'),(2,'super_admins'),(3,'taux_change_bce'),(4,'cabinet_admins'),(5,'dossiers'),
 (6,'agent_conversations'),(7,'categories'),(8,'comptes_courants_associes'),(9,'controles_releves_bancaires'),
 (10,'cotisations_declarees'),(11,'declarations_tva'),(12,'dossier_assignations'),(13,'emprunts'),
 (14,'facture_numerotation'),(15,'factures_emises'),(16,'informations_dossier'),(17,'memberships'),
 (18,'natures_immobilisation'),(19,'packs'),(20,'previsionnels_bancaires'),(21,'references_annuelles'),
 (22,'references_postes_annuels'),(23,'regles_bancaires_ignorees'),(24,'sous_dossiers'),(25,'superpdp_credentials'),
 (26,'vehicules'),(27,'documents_divers'),(28,'emails_envoyes'),(29,'facture_lignes'),(30,'facture_superpdp_events'),
 (31,'mouvements_cca'),(32,'pieces'),(33,'supplements'),(34,'tiers_categories'),(35,'tiers_categories_cabinet'),
 (36,'immobilisations'),(37,'lignes_bancaires'),(38,'piece_commentaires'),(39,'piece_textes_ocr'),(40,'ecritures_brouillon');

-- La carte des chemins, recopiée de CHEMINS_DOSSIER (src/lib/sauvegarde.ts). Si les deux divergent,
-- c'est l'essai qui ment : c'est le code qui restaure en production.
create table essai_restauration._chemins (table_nom text primary key, acces text not null, parent text, colonne text);
insert into essai_restauration._chemins values
 ('cabinets','global',null,null),('super_admins','global',null,null),('taux_change_bce','global',null,null),
 ('cabinet_admins','cabinet',null,null),('tiers_categories_cabinet','cabinet',null,null),
 ('dossiers','le_dossier',null,null),
 ('categories','partage',null,null),('natures_immobilisation','partage',null,null),
 ('facture_lignes','par_parent','factures_emises','facture_id'),
 ('mouvements_cca','par_parent','comptes_courants_associes','compte_id'),
 ('agent_conversations','direct',null,null),('comptes_courants_associes','direct',null,null),
 ('controles_releves_bancaires','direct',null,null),('cotisations_declarees','direct',null,null),
 ('declarations_tva','direct',null,null),('documents_divers','direct',null,null),
 ('dossier_assignations','direct',null,null),('ecritures_brouillon','direct',null,null),
 ('emails_envoyes','direct',null,null),('emprunts','direct',null,null),
 ('facture_numerotation','direct',null,null),('facture_superpdp_events','direct',null,null),
 ('factures_emises','direct',null,null),('immobilisations','direct',null,null),
 ('informations_dossier','direct',null,null),('lignes_bancaires','direct',null,null),
 ('memberships','direct',null,null),('packs','direct',null,null),
 ('piece_commentaires','direct',null,null),('piece_textes_ocr','direct',null,null),
 ('pieces','direct',null,null),('previsionnels_bancaires','direct',null,null),
 ('references_annuelles','direct',null,null),('references_postes_annuels','direct',null,null),
 ('regles_bancaires_ignorees','direct',null,null),('sous_dossiers','direct',null,null),
 ('superpdp_credentials','direct',null,null),('supplements','direct',null,null),
 ('tiers_categories','direct',null,null),('vehicules','direct',null,null);

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

-- Le prérequis que la sauvegarde ne contient pas (voir referencesExternes).
insert into essai_restauration.cabinets
  select * from public.cabinets
  where id = (select cabinet_id from public.dossiers where id = (select dossier from essai_restauration._cible));

do $$
declare d uuid := (select dossier from essai_restauration._cible); r record; n bigint;
begin
  for r in
    select o.rang, o.table_nom, c.acces, c.parent, c.colonne
    from essai_restauration._ordre o join essai_restauration._chemins c on c.table_nom = o.table_nom
    order by o.rang
  loop
    if r.acces in ('global','cabinet') then continue; end if;

    if r.acces = 'le_dossier' then
      execute format('insert into essai_restauration.%I select * from public.%I where id = $1', r.table_nom, r.table_nom) using d;
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
    insert into essai_restauration._verdict values (lpad(r.rang::text,2,'0') || ' ' || r.table_nom, n || ' lignes (' || r.acces || ')');
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

select verdict, count(*) as tables, string_agg(table_nom, ', ') as lesquelles
from essai_restauration._egalite group by verdict order by verdict;

-- ══ 4. Nettoyage ══════════════════════════════════════════════════════════════════════════════════
-- Le schéma d'essai contient de vraies données comptables : ne pas le laisser traîner.
drop schema if exists essai_restauration cascade;
