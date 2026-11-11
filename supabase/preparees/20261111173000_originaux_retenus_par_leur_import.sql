-- A8D2A-Q1 : L'ORIGINAL D'UNE FACTURE REPRISE NE SE SUPPRIME PLUS TANT QUE SON IMPORT EXISTE (ligne 51.5 ; décision du
-- cabinet du 11/11/2026, réponse (B), contre la recommandation ; PRÉPARÉE, PAS APPLIQUÉE). Le récit : HISTORIQUE.md,
-- « 11/11/2026 — A8D2A-Q1 : L'ORIGINAL D'UNE FACTURE REPRISE RETENU PAR SON IMPORT (PRÉPARÉE, PAS APPLIQUÉE) ». L'essai :
-- supabase/essais/originalDUnImport.sql (sur une réplique seulement : il supprime des lignes de `storage.objects` et des
-- dossiers) et le bloc OR de supabase/essais/rls.sql (en production aussi : il juge les prédicats sans rien supprimer).
-- Le retour : supabase/preparees/retour/20261111173100_retour_originaux_retenus_par_leur_import.sql.
--
-- LE DÉFAUT. Depuis `originaux_des_imports` (A8d2a, en production le 11/11/2026), le seau `ventes` porte l'original d'une
-- facture reprise de l'ancien logiciel sous `<dossier>/imports/<lot>/<empreinte>.<pdf|xml|csv>`, et les lignes de l'import
-- le désignent par son chemin (`imports_factures.fichier_chemin` pour le fichier du lot, `factures_importees.
-- fichier_chemin` pour celui d'une facture). Mais le chef du cabinet pouvait le retirer du seau à tout moment
-- (`ventes_suppression_par_le_chef`, comme tout fichier du seau) : l'import restait, ses factures comptées, son original
-- disparu, et l'empreinte gardée par la ligne ne vérifiait plus rien. Même défaut qu'INAL1 pour la pièce figée, même
-- source : la conservation des documents et des pièces justificatives, sous la forme où ils ont été établis ou reçus
-- (LPF, art. L102 B, I). Le cas que l'application rencontrait déjà : un import réussi en base, dont la réponse se perd
-- (réseau coupé) — l'écran, croyant l'import échoué, retirait les originaux qu'il venait de déposer
-- (`importerLeLot`, src/lib/importDesFacturesLecture.ts).
--
-- LE MÉCANISME, TEL QUE LE CATALOGUE LE DIT (relevé du 11/11/2026, la réplique égale à la production : 197 migrations,
-- neuf familles de signature.sql, les douze policies du stockage et les quatre seaux à leur empreinte) :
--   - l'API du stockage supprime sous la session de l'appelant, `storage.allow_delete_query` posé, en nommant ses lignes
--     et en les rendant : une ligne que la policy de LECTURE ou celle de SUPPRESSION écarte n'est pas supprimée, sans
--     erreur, et le fichier reste (PostgreSQL 17, « CREATE POLICY », « Policies Applied by Command Type ») ;
--   - `ventes_suppression_par_le_chef` cherche le cabinet du dossier dans SA LIGNE : la ligne du dossier partie, plus
--     personne — pas même le super-administrateur — ne retire un fichier du seau `ventes` par l'API. C'est pourquoi le
--     second passage d'INAL1 (le super-administrateur reprend, la ligne partie, ce que plus rien ne fige) ne suffirait pas
--     ici, et ne servirait de toute façon qu'à lui : un chef qui ne l'est pas laisserait les originaux d'un dossier
--     supprimé dans le seau, et le bilan dirait « préviens l'administrateur ». La suppression d'un dossier est le geste
--     auquel se ramène une demande d'effacement (RGPD.md) : elle doit rester d'un seul geste, pour tout chef ;
--   - une suppression de `dossiers` emporte ses imports par la cascade de leurs clés ; un déclencheur BEFORE DELETE de
--     ligne s'exécute avant que la ligne et ses dépendantes ne partent, dans la même instruction, et une erreur plus loin
--     annule tout ce qu'il a écrit (PostgreSQL 17, « CREATE TRIGGER », « Overview of Trigger Behavior »).
--
-- CE QUI CHANGE.
--   1. `original_d_un_import(p_chemin)`, une lecture `security definer` sur le modèle de `fichier_fige` (INAL1) : vrai quand
--      le chemin est le fichier d'un import qui existe — celui du lot ou celui d'une de ses factures ; NUL pour qui
--      n'administre pas le dossier du chemin, et pour un chemin qui ne commence pas par un dossier, sans rien lever. Deux
--      index (les deux chemins) : la policy l'appelle pour chaque fichier qu'une suppression vise.
--   2. `originaux_liberes` : les originaux d'un dossier QUI VIENT D'ÊTRE SUPPRIMÉ, rendus au cabinet de ce dossier pour
--      qu'il les retire du seau. Une ligne par chemin, le cabinet, l'instant. RLS active, AUCUNE policy : seules les deux
--      fonctions ci-dessous la lisent ou l'écrivent.
--   3. `liberer_les_originaux_du_dossier()`, déclencheur BEFORE DELETE de chaque ligne de `dossiers` : il range dans
--      `originaux_liberes` les chemins que les imports du dossier désignent, sous le cabinet du dossier — ce que la
--      protection retenait, et seulement cela. Il fait d'abord le ménage des libérations dont le fichier a quitté le seau
--      (leur objet est rempli). Il ne refuse rien : il n'écrit que des chemins que les contraintes des imports ont déjà
--      jugés, sous une clé qui ne peut pas manquer (`dossiers.cabinet_id`, NOT NULL).
--   4. `original_libere(p_chemin)`, une lecture `security definer` : vrai quand le chemin est un original libéré, que le
--      dossier du chemin n'existe plus, et que l'appelant est chef du cabinet de la libération (le super-administrateur
--      l'est de tous) ; faux sinon.
--   5. `ventes_suppression_par_le_chef` : sous `<dossier>/imports/`, le chef du cabinet du dossier, et le fichier n'est
--      pas l'original d'un import qui existe — OU l'original est libéré ; ailleurs dans le seau (le logo), comme hier.
--   6. `ventes_lecture` : sous `<dossier>/imports/`, le cabinet du dossier comme hier — OU l'original est libéré (la
--      suppression de l'API rend ses lignes : sans la lecture, le second passage ne verrait rien) ; ailleurs, comme hier.
--
-- LES SORTIES, OUVERTES.
--   - « Retirer l'import » (`retirer_import`, puis l'écran retire les fichiers) : la fonction retire les LIGNES ; plus rien
--     ne désigne alors les originaux, et le chef les retire comme hier. L'ordre de l'écran (les lignes, puis les fichiers)
--     tient ; l'ordre inverse est désormais refusé.
--   - La suppression d'un dossier (src/lib/suppressionDossier.ts), D'UN SEUL GESTE, pour tout chef : le premier passage
--     (avant la ligne) retire tout sauf les originaux retenus, sans erreur ; la ligne du dossier part, le déclencheur
--     libère ses originaux au cabinet, la cascade emporte les imports ; le second passage (le même code, déjà là pour
--     INAL1) les retire. Si ce second passage échoue (réseau), la libération reste : le chef, ou le super-administrateur,
--     peut encore les retirer par l'API ; le bilan de la suppression les compte, comme aujourd'hui.
--   - La restauration ne supprime aucun fichier du seau, et réinsère les lignes d'un import (`imports_factures_restauration`,
--     le super-administrateur) sans rien de neuf à franchir ; une ligne réinsérée retient de nouveau son original. Un
--     dossier restauré sous son identifiant éteint la libération de ses originaux (le dossier existe de nouveau).
--
-- CE QU'ELLE N'OUVRE PAS, ET CE QU'ELLE OUVRE. L'original d'un import qui existe ne se supprime plus — pas même par le
-- super-administrateur ; le dépôt, la lecture d'un original vivant, le logo, le seau des pièces ne changent pas. Ce qui
-- s'ouvre : au chef du cabinet d'un dossier supprimé (au super-administrateur), la lecture et la suppression des seuls
-- originaux que ce dossier retenait, après sa ligne et non plus avant — ce que ce même chef supprimait hier au premier
-- passage. C'est un ÉLARGISSEMENT de deux policies (un dossier qui n'existe plus n'y donnait rien) : il se présente au
-- cabinet avant d'être collé.
--
-- LA VOIE. Le texte ne retire aucun objet ni aucune donnée d'hier ; mais il porte le mot de la suppression — l'événement
-- du déclencheur (BEFORE DELETE) et le ménage des libérations closes — : par la règle de la session, il SE COLLE dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Aucune barre
-- oblique inverse, aucun retour chariot.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. La garde : l'état d'hier, entier, ou rien ══════════
do $garde$
declare
  v record;
  v_chemin constant text := current_setting('search_path');
begin
  if to_regprocedure('public.original_d_un_import(text)') is not null or to_regclass('public.originaux_liberes') is not null then
    raise exception 'La protection des originaux des imports est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
     or not exists (select 1 from storage.buckets where id = 'ventes')
     or to_regprocedure('storage.foldername(text)') is null
     or md5((select p.prosrc from pg_proc p where p.oid = to_regprocedure('storage.foldername(text)')))
        is distinct from 'd74c9ac376970bf5b265ecb58e855df9' then
    raise exception 'Le stockage n''est pas celui que la migration suppose (storage.objects, storage.buckets, le seau ventes, storage.foldername) : relire la base.';
  end if;
  -- Les colonnes que les fonctions lisent ; le cabinet d'un dossier, que la libération range, toujours présent.
  for v in select * from (values
      ('public.imports_factures', 'fichier_chemin'), ('public.imports_factures', 'dossier_id'),
      ('public.factures_importees', 'fichier_chemin'), ('public.factures_importees', 'dossier_id'),
      ('public.dossiers', 'cabinet_id')) x(rel, col) loop
    if to_regclass(v.rel) is null or not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(v.rel)
                                                   and a.attname = v.col and not a.attisdropped) then
      raise exception 'La colonne %.% manque : relire la base.', v.rel, v.col;
    end if;
  end loop;
  if not (select a.attnotnull from pg_attribute a where a.attrelid = 'public.dossiers'::regclass and a.attname = 'cabinet_id') then
    raise exception 'dossiers.cabinet_id n''est plus obligatoire : la libération ne saurait pas à quel cabinet rendre un original.';
  end if;
  -- Les fonctions qu'elles appellent, à l'empreinte de leur corps (les retours chariot d'un collage écartés).
  for v in select * from (values
      ('public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('public.est_chef_du_cabinet(uuid)', 'df3eeeaf2095b1c86c3bca7624243a0b')) x(fonction, empreinte) loop
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), ''))
          is distinct from v.empreinte then
      raise exception 'La fonction % n''est pas celle que cette migration suppose : relire la migration contre la base avant de l''appliquer.', v.fonction;
    end if;
  end loop;
  -- Les quatre policies du seau des ventes, à l'empreinte de leur commande, de leurs rôles et de leurs prédicats (lus sous un
  -- chemin vide, qui nomme le schéma de chaque fonction) : l'état d'A8d2a.
  perform set_config('search_path', '', true);
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polroles::regrole[]::text || ':'
                        || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '')) || ':'
                        || md5(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), ',' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and left(p.polname, 7) = 'ventes_' and p.polpermissive)
     is distinct from 'ventes_depot_d_un_logo:a:{authenticated}:d41d8cd98f00b204e9800998ecf8427e:350f5807eb36593cbe508baf6176333a,ventes_depot_d_un_original:a:{authenticated}:d41d8cd98f00b204e9800998ecf8427e:571ca4536531eba8020daafcea00b255,ventes_lecture:r:{authenticated}:821b3505fd9b2a7f2367ec0898c83645:d41d8cd98f00b204e9800998ecf8427e,ventes_suppression_par_le_chef:d:{authenticated}:f4be98cf500b3037eba40f0f8e3ea94c:d41d8cd98f00b204e9800998ecf8427e' then
    raise exception 'Les policies du seau des ventes ne sont plus celles d''A8d2a : relire la migration contre la base avant de l''appliquer.';
  end if;
  -- Toute la surface de lecture et de suppression de storage.objects, policies permissives : une autre policy qui
  -- ouvrirait le seau ventes s'ajouterait par OU à la protection et la défairait. Une policy restrictive ne fait que
  -- restreindre (`deux_facteurs`, si sa migration passe avant) : elle n'entre pas dans la comparaison.
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '')),
                        ',' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('d', 'r', '*') and p.polpermissive)
     is distinct from 'cabinet_logos_lecture_publique:r:4ed3fb5c4b2223a2da39986bf9e58b5a,cabinet_logos_suppression_chef:d:fc46cee26a76edcb9a6f03a0d3cd7b1e,packs_storage_all:*:a8ac8b3ed86beb70e800f88abb083b3b,pieces_storage_delete:d:9e18e5892c39a520b111ec1dfccf1e95,pieces_storage_select:r:8e571d8ec6b982f099075cb7ef3710fa,ventes_lecture:r:821b3505fd9b2a7f2367ec0898c83645,ventes_suppression_par_le_chef:d:f4be98cf500b3037eba40f0f8e3ea94c' then
    raise exception 'Les policies de lecture et de suppression de storage.objects ne sont plus celles d''hier : relire la migration contre la base avant de l''appliquer.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$garde$;

-- ══ 1. Les index que la policy lit ══════════
create index imports_factures_fichier_chemin_idx on public.imports_factures (fichier_chemin) where fichier_chemin is not null;
create index factures_importees_fichier_chemin_idx on public.factures_importees (fichier_chemin) where fichier_chemin is not null;

-- ══ 2. L'original d'un import qui existe ══════════
create function public.original_d_un_import(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Le dossier que le chemin nomme se tire après la forme du chemin, dans cet ordre (`case` n'évalue une branche qu'à son
  -- tour) : un chemin mal formé ne fait rien lever. La forme est celle des policies du seau (des minuscules).
  select case
    when p_chemin is null then null
    when p_chemin !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then null
    when not public.admin_du_dossier(split_part(p_chemin, '/', 1)::uuid) then null
    else exists (select 1 from public.imports_factures l where l.fichier_chemin = p_chemin)
      or exists (select 1 from public.factures_importees f where f.fichier_chemin = p_chemin)
  end
$$;

revoke execute on function public.original_d_un_import(text) from public, anon;
grant execute on function public.original_d_un_import(text) to authenticated;

comment on function public.original_d_un_import(text) is
  'Vrai quand le chemin est l''original d''un import de factures reprises qui existe — le fichier du lot (imports_factures) ou celui d''une de ses factures (factures_importees) ; nul pour qui n''administre pas le dossier du chemin, et pour un chemin qui ne commence pas par un dossier. La policy ventes_suppression_par_le_chef refuse la suppression d''un tel fichier (A8D2A-Q1, ligne 51.5) ; retirer_import le rend libre.';

-- ══ 3. Les originaux d'un dossier supprimé, rendus à son cabinet ══════════
create table public.originaux_liberes (
  chemin text primary key,
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  libere_le timestamptz not null default now(),
  -- La forme même des chemins des imports (`imports_factures_chemin_du_lot`, `factures_importees_chemin_du_lot`) : le
  -- déclencheur n'écrit que les leurs, et cette contrainte ne peut donc jamais refuser la suppression d'un dossier.
  constraint originaux_liberes_chemin_d_un_import check (chemin ~ '^[0-9a-f-]{36}/imports/[0-9a-f-]{36}/[^/]{1,200}$')
);

alter table public.originaux_liberes enable row level security;

comment on table public.originaux_liberes is
  'Les originaux des factures reprises d''un dossier supprimé (A8D2A-Q1, ligne 51.5) : un chemin du seau ventes, le cabinet du dossier, l''instant de la suppression. Écrite par le déclencheur de la suppression d''un dossier seul (liberer_les_originaux_du_dossier), lue par original_libere seule : RLS active, aucune policy. Une ligne rend au chef de ce cabinet (et au super-administrateur) la lecture et la suppression de ce fichier, tant que le dossier n''existe plus ; elle s''efface à la suppression de dossier suivante, une fois le fichier parti.';

-- La double authentification exigée (préparée, 20261107160000) : appliquée avant celle-ci, sa policy restrictive se pose
-- ici sur la table neuve ; appliquée après, sa boucle sur pg_class la prend d'elle-même.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.originaux_liberes as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

-- ══ 4. La libération, quand la ligne d'un dossier part ══════════
create function public.liberer_les_originaux_du_dossier() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Le ménage d'abord : une libération dont le fichier a quitté le seau n'a plus d'objet. Le propriétaire de la fonction
  -- lit tout le seau (en production, `postgres`, qui passe la RLS) : une libération d'un autre cabinet dont le fichier
  -- reste n'est jamais effacée.
  delete from public.originaux_liberes o
   where not exists (select 1 from storage.objects s where s.bucket_id = 'ventes' and s.name = o.chemin);
  -- Puis les originaux de ce dossier, sous son cabinet : ce que la protection retenait, et seulement cela.
  insert into public.originaux_liberes (chemin, cabinet_id)
  select c.chemin, old.cabinet_id
    from (select l.fichier_chemin as chemin from public.imports_factures l
           where l.dossier_id = old.id and l.fichier_chemin is not null
          union
          select f.fichier_chemin from public.factures_importees f
           where f.dossier_id = old.id and f.fichier_chemin is not null) c
  on conflict (chemin) do update set cabinet_id = excluded.cabinet_id, libere_le = excluded.libere_le;
  return old;
end
$$;

revoke all on function public.liberer_les_originaux_du_dossier() from public, anon, authenticated, service_role;

comment on function public.liberer_les_originaux_du_dossier() is
  'Déclencheur BEFORE DELETE de chaque ligne de dossiers (A8D2A-Q1, ligne 51.5) : range dans originaux_liberes les chemins que les imports du dossier désignent, sous le cabinet du dossier, après avoir effacé les libérations dont le fichier a quitté le seau ventes. Ne refuse rien ; une suppression annulée plus loin emporte ce qu''il a écrit.';

create trigger dossiers_liberer_les_originaux
  before delete on public.dossiers
  for each row execute function public.liberer_les_originaux_du_dossier();

-- ══ 5. L'original libéré ══════════
create function public.original_libere(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_chemin is null or p_chemin !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/' then false
    else exists (select 1 from public.originaux_liberes o
                  where o.chemin = p_chemin and public.est_chef_du_cabinet(o.cabinet_id))
         and not exists (select 1 from public.dossiers d where d.id = split_part(p_chemin, '/', 1)::uuid)
  end
$$;

revoke execute on function public.original_libere(text) from public, anon;
grant execute on function public.original_libere(text) to authenticated;

comment on function public.original_libere(text) is
  'Vrai quand le chemin est un original libéré par la suppression de son dossier (originaux_liberes), que ce dossier n''existe plus, et que l''appelant est chef du cabinet de la libération (le super-administrateur l''est de tous) ; faux sinon. Les policies ventes_lecture et ventes_suppression_par_le_chef lui ouvrent ce fichier (A8D2A-Q1, ligne 51.5).';

-- ══ 6. La lecture et la suppression du seau des ventes ══════════
alter policy ventes_lecture on storage.objects
  using (
    bucket_id = 'ventes'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/' then public.admin_du_dossier((storage.foldername(name))[1]::uuid) or public.original_libere(name)
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then public.gere_les_ventes((storage.foldername(name))[1]::uuid)
      else false
    end
  );

alter policy ventes_suppression_par_le_chef on storage.objects
  using (
    bucket_id = 'ventes'
    and case
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/' then
        (exists (select 1 from public.dossiers d where d.id = (storage.foldername(name))[1]::uuid and public.est_chef_du_cabinet(d.cabinet_id))
         and not public.original_d_un_import(name))
        or public.original_libere(name)
      when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then
        exists (select 1 from public.dossiers d where d.id = (storage.foldername(name))[1]::uuid and public.est_chef_du_cabinet(d.cabinet_id))
      else false
    end
  );

-- ══ 7. La garde de fin : ce que la base porte désormais ══════════
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                  and p.polname = 'ventes_suppression_par_le_chef' and p.polcmd = 'd' and p.polpermissive
                  and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
                  and pg_get_expr(p.polqual, p.polrelid) like '%NOT public.original_d_un_import(name)%'
                  and pg_get_expr(p.polqual, p.polrelid) like '%OR public.original_libere(name)%')
     or not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                     and p.polname = 'ventes_lecture' and p.polcmd = 'r' and p.polpermissive
                     and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
                     and pg_get_expr(p.polqual, p.polrelid) like '%public.admin_du_dossier(((storage.foldername(name))[1])::uuid) OR public.original_libere(name)%') then
    raise exception 'Garde de fin : les policies du seau des ventes ne sont pas celles que la migration pose.';
  end if;
  if (select count(*) from pg_depend d join pg_policy p on p.oid = d.objid
       where d.classid = 'pg_policy'::regclass and p.polrelid = 'storage.objects'::regclass
         and d.refclassid = 'pg_proc'::regclass
         and ((p.polname = 'ventes_suppression_par_le_chef' and d.refobjid in ('public.original_d_un_import(text)'::regprocedure, 'public.original_libere(text)'::regprocedure))
              or (p.polname = 'ventes_lecture' and d.refobjid = 'public.original_libere(text)'::regprocedure))) <> 3 then
    raise exception 'Garde de fin : les policies du seau des ventes ne dépendent pas des deux fonctions.';
  end if;
  if has_function_privilege('anon', 'public.original_d_un_import(text)', 'execute')
     or has_function_privilege('anon', 'public.original_libere(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.original_d_un_import(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.original_libere(text)', 'execute')
     or has_function_privilege('authenticated', 'public.liberer_les_originaux_du_dossier()', 'execute')
     or (select count(*) from pg_proc p
          where p.oid in ('public.original_d_un_import(text)'::regprocedure, 'public.original_libere(text)'::regprocedure)
            and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']) <> 2 then
    raise exception 'Garde de fin : les fonctions n''ont pas les droits ou la forme attendus.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_liberer_les_originaux'
                  and t.tgfoid = 'public.liberer_les_originaux_du_dossier()'::regprocedure and t.tgenabled = 'O'
                  and t.tgtype = 11)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.originaux_liberes'::regclass)
     or exists (select 1 from pg_policy p where p.polrelid = 'public.originaux_liberes'::regclass and p.polpermissive) then
    raise exception 'Garde de fin : le déclencheur de la libération ou la table des originaux libérés ne sont pas ceux attendus.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
