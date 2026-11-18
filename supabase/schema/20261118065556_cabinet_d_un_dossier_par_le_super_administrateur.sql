-- LE CABINET D'UN DOSSIER NE CHANGE QUE PAR LE SUPER-ADMINISTRATEUR (RATT-Q1 ; PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE).
-- Le récit : HISTORIQUE.md, « 13/11/2026 — LE CABINET D'UN DOSSIER NE CHANGE QUE PAR LE SUPER-ADMINISTRATEUR » ;
-- l'essai : le bloc RT de supabase/essais/rls.sql ; le retour :
-- supabase/preparees/retour/20261113164100_retour_cabinet_d_un_dossier_par_le_super_administrateur.sql.
--
-- SOURCES. PostgreSQL 17 : CREATE TRIGGER (un déclencheur BEFORE … FOR EACH ROW qui lève annule l'instruction ; sa
-- clause WHEN se juge sur la ligne telle que les déclencheurs précédents l'ont laissée ; ceux d'un même genre tirent
-- dans l'ordre alphabétique de leur nom ; le droit EXECUTE sur la fonction ne se vérifie qu'à la création du
-- déclencheur) ; « System Information Functions » (`row_security_active` : la RLS s'applique-t-elle à cette table, pour
-- l'utilisateur courant) ; CREATE POLICY (une policy de mise à jour juge la ligne proposée par son WITH CHECK, ou à
-- défaut par son USING).
--
-- LA RÈGLE. Le cabinet d'un dossier (`dossiers.cabinet_id`) ne change que par le super-administrateur. Hors de la RLS —
-- le propriétaire, la restauration jouée par le super-utilisateur, une fonction `security definer` (qui juge l'accès
-- elle-même), le rôle des Edge Functions —, rien n'est jugé ici. L'application ne change jamais ce cabinet ; elle le
-- pose à la création (la policy d'insertion `dossiers_write`, sur la valeur proposée, et `set_cabinet_id_dossier`), et
-- la restauration l'insère avec le dossier : ni l'une ni l'autre n'est une mise à jour.
--
-- DEUX RÈGLES DISTINCTES. Qui écrit un dossier : la policy `dossiers_update` (`admin_du_dossier`), inchangée. Qui
-- change son cabinet : cette garde. Le dossier du cabinet (LM1) garde la sienne, plus stricte
-- (`garder_cabinet_du_dossier_du_cabinet` : il ne change de cabinet pour personne) ; son déclencheur
-- (`dossiers_cabinet_du_dossier_du_cabinet`) tire avant celui-ci, dont le nom le suit dans l'alphabet : son refus
-- (23514) reste le premier dit.
--
-- CE QU'ELLE FAIT : une garde, `public.garder_cabinet_d_un_dossier()`, `security INVOKER` (pour que
-- `row_security_active` juge l'appelant, et non le propriétaire de la fonction), chemin vide, exécutable par aucun rôle
-- de session, posée par le déclencheur `dossiers_cabinet_par_le_super_administrateur`, BEFORE UPDATE FOR EACH ROW sur
-- `dossiers`, sous `WHEN (old.cabinet_id is distinct from new.cabinet_id)` : une mise à jour qui ne change pas le
-- cabinet n'appelle rien, et un changement que ferait un autre déclencheur se verrait (aucun ne réécrit ce cabinet : la
-- garde de tête le vérifie). Dans la RLS, hors du super-administrateur (`is_super_admin`), elle lève 42501 : « Le
-- cabinet d'un dossier ne change que par le super-administrateur. »
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune policy, aucune garde existante, aucun écran (l'application ne change
-- jamais ce cabinet). La restauration (une insertion, puis la seconde passe sur `factures_emises` seulement), la fin
-- d'un dossier, le départ d'un client (INAL5, préparée : un déclencheur BEFORE sur une autre commande), le dossier du
-- cabinet (LM1) et la porte d'accès (`acces_avant_les_gardes`, préparée, qui écarte `dossiers` et dont les tables ne
-- reçoivent ici aucun déclencheur) jugent comme hier ; elle s'applique avant ou après cette dernière. Le coût : une
-- comparaison par mise à jour d'un dossier, un appel de plus quand le cabinet change. Le texte ne porte aucun mot de
-- retrait ni de vidage : par l'outil.

-- La garde de tête : la migration ne se rejoue pas ; la RLS de `dossiers` active et non forcée (sinon la garde jugerait
-- aussi le propriétaire) ; `is_super_admin` exécutable par authenticated (la garde l'appelle sous la session) ; aucun
-- déclencheur de mise à jour de `dossiers` ne réécrit le cabinet.
do $garde$
declare
  v_reecrit text;
begin
  if to_regprocedure('public.garder_cabinet_d_un_dossier()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.dossiers'::regclass
                 and t.tgname = 'dossiers_cabinet_par_le_super_administrateur') then
    raise exception 'cabinet_d_un_dossier_par_le_super_administrateur : la garde est déjà en base ; cette migration ne se rejoue pas.';
  end if;
  if not (select c.relrowsecurity and not c.relforcerowsecurity from pg_catalog.pg_class c where c.oid = 'public.dossiers'::regclass) then
    raise exception 'cabinet_d_un_dossier_par_le_super_administrateur : la RLS de public.dossiers n''est pas active, ou elle est forcée au propriétaire : la garde jugerait autrement que la base.';
  end if;
  if to_regprocedure('public.is_super_admin()') is null
     or not has_function_privilege('authenticated', 'public.is_super_admin()', 'execute') then
    raise exception 'cabinet_d_un_dossier_par_le_super_administrateur : public.is_super_admin() manque, ou authenticated ne l''exécute pas : la garde refuserait pour une autre raison.';
  end if;
  select string_agg(t.tgname, ', ') into v_reecrit
    from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.dossiers'::regclass and not t.tgisinternal and (t.tgtype & 16) = 16
     and p.prosrc ~* 'new\s*\.\s*"?cabinet_id"?\s*:?=';
  if v_reecrit is not null then
    raise exception 'cabinet_d_un_dossier_par_le_super_administrateur : le déclencheur % réécrit le cabinet d''un dossier à la mise à jour : la clause WHEN est à relire.', v_reecrit;
  end if;
end
$garde$;

create function public.garder_cabinet_d_un_dossier()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fonction$
begin
  -- Hors de la RLS (le propriétaire, la restauration par le super-utilisateur, une fonction security definer, le rôle
  -- des Edge Functions) : rien n'est jugé ici. Dans la RLS, le super-administrateur seul change le cabinet d'un
  -- dossier.
  if new.cabinet_id is distinct from old.cabinet_id
     and pg_catalog.row_security_active(tg_relid)
     and not public.is_super_admin() then
    raise exception 'Le cabinet d''un dossier ne change que par le super-administrateur.' using errcode = '42501';
  end if;
  return new;
end
$fonction$;

revoke all on function public.garder_cabinet_d_un_dossier() from public, anon, authenticated;

comment on function public.garder_cabinet_d_un_dossier() is
  'Garde de dossiers (RATT-Q1) : dans la RLS, le cabinet d''un dossier ne change que par le super-administrateur (42501) ; hors de la RLS, rien n''est jugé ici.';

create trigger dossiers_cabinet_par_le_super_administrateur
  before update on public.dossiers
  for each row
  when (old.cabinet_id is distinct from new.cabinet_id)
  execute function public.garder_cabinet_d_un_dossier();
