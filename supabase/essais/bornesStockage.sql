-- LES BORNES DES SEAUX DU STOCKAGE (ligne 22.6 ; le quatrième, `ventes`, étape A5c1 de l'espace client) — à jouer par
-- l'outil MCP `execute_sql`, en LECTURE SEULE, après l'application de la migration `bornes_du_stockage`, et de nouveau
-- après celle de `logo_des_factures`, qui pose le seau `ventes` et ses bornes.
--
-- Une ligne par seau : `ok` quand il porte exactement les bornes attendues — sa taille en octets, ses types (comparés en
-- ensembles, l'ordre n'y fait rien) et son accès public inchangé ; sinon `EN FAUTE` et ce qu'il porte. Le seau `ventes`
-- absent se dit `EN ATTENTE` tant que l'historique ne porte pas `logo_des_factures` (ou qu'un retour arrière plus récent
-- l'a ôté), `EN FAUTE` sinon. Puis les seaux qu'aucune ligne n'attend (aucun : un seau de plus n'aurait aucune borne), et
-- les fichiers DÉJÀ déposés qui dépassent une borne : le stockage ne juge que les dépôts nouveaux, et un tel fichier n'est
-- pas un refus mais une chose à savoir (une pièce plus lourde que la borne ne se redéposerait plus telle quelle — la
-- restauration du plan de reprise, §4.6, la redépose). Les deux témoins de l'essai RLS, créés en SQL et sans
-- métadonnées, n'y comptent pas.
--
-- Les valeurs attendues sont celles de src/lib/bornesStockage.ts et de la migration : bornesStockage.test.ts confronte
-- les trois, valeur par valeur.
--
-- Joué le 12/10/2026 AVANT l'application (la migration préparée, pas appliquée) : les trois seaux EN FAUTE (« taille
-- aucune »), trois seaux, aucun fichier hors des bornes — c'est l'état que la migration corrige.
--
-- Joué le 17/10/2026 sur une réplique égale à la production (étape A5c1) : sans `logo_des_factures`, les trois seaux
-- « ok », `ventes` « EN ATTENTE », aucun seau sans borne attendue, aucun fichier hors des bornes ; avec elle, les quatre
-- « ok ».
with attendu(seau, publique, taille, types) as (
  values ('pieces', false, 20971520::bigint, array['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'text/plain']),
         ('packs', false, 52428800::bigint, array['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
         ('cabinet-logos', true, 512000::bigint, array['image/png', 'image/jpeg', 'image/webp']),
         ('ventes', false, 512000::bigint, array['image/png', 'image/jpeg'])
),
historique as (
  select max(version) filter (where name = 'logo_des_factures') as applique,
         max(version) filter (where name = 'retour_logo_des_factures') as retour
    from supabase_migrations.schema_migrations
),
seaux as (
  select a.seau, a.publique, a.taille,
         (select array_agg(t order by t) from unnest(a.types) t) as types_attendus,
         b.id is not null as present, b.public,
         b.file_size_limit,
         (select array_agg(t order by t) from unnest(b.allowed_mime_types) t) as types_poses
  from attendu a left join storage.buckets b on b.id = a.seau
),
hors_bornes as (
  select count(*) as nombre
  from storage.objects o join attendu a on a.seau = o.bucket_id
  where o.metadata is not null
    and ((o.metadata->>'size')::bigint > a.taille
         or lower(split_part(o.metadata->>'mimetype', ';', 1)) <> all (a.types))
)
select seau as quoi,
       case
         when not present and seau = 'ventes'
              and ((select applique from historique) is null or (select retour > applique from historique))
           then 'EN ATTENTE : la migration logo_des_factures n''est pas en base'
         when not present then 'EN FAUTE : seau absent'
         when public is distinct from publique then 'EN FAUTE : public = ' || public
         when file_size_limit is distinct from taille then 'EN FAUTE : taille ' || coalesce(file_size_limit::text, 'aucune')
         when types_poses is distinct from types_attendus then 'EN FAUTE : types ' || coalesce(array_to_string(types_poses, ', '), 'aucun')
         else 'ok'
       end as verdict
from seaux
union all
select 'seaux sans borne attendue',
       case when not exists (select 1 from storage.buckets b where b.id not in (select seau from attendu)) then 'ok'
            else 'EN FAUTE : ' || (select string_agg(b.id, ', ' order by b.id) from storage.buckets b where b.id not in (select seau from attendu)) end
union all
select 'fichiers déjà déposés hors des bornes',
       case when nombre = 0 then 'ok' else 'À VOIR : ' || nombre || ' fichier(s)' end
from hors_bornes;
