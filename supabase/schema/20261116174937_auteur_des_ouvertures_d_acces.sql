-- QUI A OUVERT UN ACCÈS CLIENT : LE COMPTE DU CABINET, ATTESTÉ SOUS SA SESSION (espace client, ligne 51.5 ; P1TQ2-Q1,
-- tranchée par le cabinet le 16/11/2026, contre la recommandation : « (A) Nommer le compte du cabinet ») — PRÉPARÉE le
-- 16/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 16/11/2026 — P1TQ2-Q1 : QUI A OUVERT UN ACCÈS CLIENT » ; l'essai :
-- supabase/essais/auteurDesOuvertures.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261116120100_retour_auteur_des_ouvertures_d_acces.sql.
--
-- LE CONSTAT. Un accès client s'ouvre par l'Edge Function `create-client-access`, qui écrit la ligne de `memberships` sous la
-- clé secrète, SANS SESSION : la trace (P1T-Q2, `tracer_les_acces`) en écrit l'arrivée — « acces », cochée, « creation » —
-- avec un auteur NUL, que l'onglet Accès dit « Sans session ». L'écrire sous la session du cabinet ne servirait pas : la base
-- prend toute insertion du super-administrateur pour une restauration et ne la trace pas, et le compte du chef du cabinet
-- est super-administrateur.
--
-- LA RÈGLE, EN DEUX TEMPS JUGÉS PAR LA BASE (le procédé de B4RS-Q1, `attester_connexion_plateforme`) :
--   1. L'Edge Function écrit l'accès comme hier ; la trace en note l'arrivée, sans auteur.
--   2. Puis, SOUS LA SESSION DE L'APPELANT, elle appelle `attester_ouverture_d_acces(dossier, accès)`. La base n'en croit que
--      le cabinet du dossier (`admin_du_dossier`, le super-administrateur compris), avant toute lecture ; elle retrouve
--      l'arrivée de CET accès, encore dans ce dossier, écrite sans session dans les cinq dernières minutes, pas encore
--      attestée, dont le titulaire n'est pas l'appelant ; et elle écrit, dans une table à part, que le compte de la session
--      — `auth.uid()`, jamais un paramètre — l'a ouverte. Sinon : 42501 sans le droit, 22023 sans arrivée attestable.
-- La trace elle-même ne change pas : elle ne se réécrit jamais (`garder_trace_des_droits`, inchangée), et ce que la base
-- n'a pas vu reste « sans session » ; l'attestation est un fait de plus, daté, à côté d'elle.
--
-- CE QUE L'ATTESTATION NE GARANTIT PAS, et que l'en-tête dit : un autre compte qui gère le même dossier pourrait, dans les
-- cinq minutes, attester avant l'Edge Function une ouverture qu'il n'a pas faite. Il ne pourrait se nommer que lui-même,
-- n'apprendrait rien, et l'attestation de l'Edge Function échouerait alors (la réponse le dit). C'est un collègue que la
-- base laisse déjà ouvrir et retirer les accès de ce dossier ; la fenêtre borne le geste à l'ouverture qu'il suit.
--
-- À QUI LE NOM S'AFFICHE, ET D'OÙ IL EST LU (le risque que la recommandation voulait éviter : P1T-E1, « nommer la personne
-- précise demanderait de montrer des adresses de l'équipe dans l'historique »). La table ne garde qu'un IDENTIFIANT de compte,
-- jamais une adresse, et ne se lit qu'au cabinet du dossier (`admin_du_dossier`) ; le client n'en voit rien. L'onglet Accès
-- (côté cabinet seul) nomme ce compte par l'adresse que la ligne de l'équipe porte (`cabinet_admins.email`), lue SOUS LA
-- SESSION de qui regarde : la policy `cabinet_admins_select` ne la rend qu'au chef du cabinet, au super-administrateur et au
-- membre lui-même. Un autre membre de l'équipe lit « Le cabinet », comme P1T-E1. Rien n'est révélé qu'il ne lise déjà.
--
-- SOURCES. PostgreSQL 17 : CREATE TRIGGER (un BEFORE … FOR EACH ROW qui lève annule l'instruction) ; « System
-- Administration Functions » (`set_config(…, true)`, local à la transaction) ; CREATE FUNCTION (SECURITY DEFINER, `SET
-- search_path`) ; CREATE POLICY. Supabase : `auth.uid()` lit le sujet du jeton de la requête ; la clé secrète n'en porte aucun.
--
-- ÉCARTÉS. (a) Réécrire l'auteur de la ligne de la trace : elle est immuable, et sa garde changerait. (b) Un auteur posé par
-- l'Edge Function sous la clé secrète : la fonction l'affirmerait, la base ne le jugerait pas. (c) Écrire l'accès par une
-- fonction appelée sous la session : le navigateur l'appellerait aussi, sans les règles de l'Edge Function (le compte
-- d'ailleurs, sa confirmation, 23-Q2). (d) Une colonne de `memberships` : le client lit sa ligne.
--
-- CE QU'ELLE POSE : la table `auteurs_des_ouvertures` (le dossier en cascade ; l'accès, la ligne de la trace et le compte
-- sans clé étrangère, comme la trace : l'attestation survit au retrait de l'accès et au départ du membre), sa garde (écrite
-- par l'attestation seule ou par la restauration du super-administrateur ; jamais réécrite ; partie avec son dossier), deux
-- policies (le cabinet du dossier lit, le super-administrateur restaure), la restrictive `deux_facteurs` si sa fonction est
-- en base, et `attester_ouverture_d_acces`.
--
-- CE QU'ELLE NE CHANGE PAS : la trace, ses deux déclencheurs, sa garde et ses policies ; `memberships` ; aucune fonction
-- existante ; aucune ligne d'avant — les ouvertures d'hier restent « sans session ». L'Edge Function d'aujourd'hui n'appelle
-- rien (sa constante `OUVERTURES_ATTESTEES_EN_BASE` baissée) ; l'écran ne lit rien (`OUVERTURES_ATTESTEES_PREVUES` baissé).
--
-- L'ORDRE : après P1T-Q2 (`arrivee_et_depart_des_acces`, en production) ; avant ou après B1 et `deux_facteurs_exiges`. Puis,
-- dans un même temps : le fichier dans l'export, `OUVERTURES_ATTESTEES_PREVUES` levé (la lecture de l'onglet et le plan de
-- sauvegarde), `create-client-access` redéployée sa constante levée.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée ; ses `revoke` ne retirent que les droits que Postgres donne d'office
-- aux deux fonctions qu'elle crée. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL. Son retour
-- retire la table et ce qu'elle porte : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une trace qui n'écrirait pas l'arrivée d'un accès (P1T-Q2) ; une colonne qui
-- manquerait à la trace ou aux accès ; un jugement du cabinet ou du super-administrateur qui ne serait plus celui que la
-- production porte (l'empreinte de leur corps, les retours chariot d'un collage écartés).
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.auteurs_des_ouvertures') is not null
     or exists (select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('attester_ouverture_d_acces', 'garder_auteurs_des_ouvertures')) then
    raise exception 'La migration auteur_des_ouvertures_d_acces est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.trace_des_droits') is null
     or not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.memberships'::regclass and not t.tgisinternal
                     and t.tgname = 'memberships_trace_des_droits_acces')
     or position('''acces''::text' in coalesce((select pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
          where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit'), '')) = 0 then
    raise exception 'La trace n''écrit pas l''arrivée d''un accès (migration arrivee_et_depart_des_acces, P1T-Q2) : l''appliquer d''abord.';
  end if;
  select count(*) into v_nombre from pg_catalog.pg_attribute a
   where a.attrelid = 'public.trace_des_droits'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname in ('id', 'dossier_id', 'acces_id', 'client_id', 'droit', 'geste', 'auteur_id', 'fait_le');
  if v_nombre <> 8 then
    raise exception 'Une colonne que l''attestation lit manque à trace_des_droits (% sur 8).', v_nombre;
  end if;
  select count(*) into v_nombre from pg_catalog.pg_attribute a
   where a.attrelid = 'public.memberships'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname in ('id', 'dossier_id', 'user_id');
  if v_nombre <> 3 then
    raise exception 'Une colonne que l''attestation lit manque à memberships (% sur 3 : id, dossier_id, user_id).', v_nombre;
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_catalog.pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
end
$garde$;

-- ══ 1. La table ══════════
create table public.auteurs_des_ouvertures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  acces_id uuid not null,
  -- L'arrivée de l'accès que la trace a écrite sans session : une attestation au plus par arrivée.
  trace_id uuid not null constraint auteurs_des_ouvertures_trace unique,
  auteur_id uuid not null,
  atteste_le timestamptz not null default now()
);

create index auteurs_des_ouvertures_dossier on public.auteurs_des_ouvertures (dossier_id, acces_id);

comment on table public.auteurs_des_ouvertures is
  'Qui a ouvert un accès client (P1TQ2-Q1) : le compte du cabinet du dossier qui, sous sa session, a attesté l''arrivée d''un accès que la trace des droits a écrite sans session (l''Edge Function create-client-access, sous la clé secrète). Écrite par attester_ouverture_d_acces seule, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien. Ne porte qu''un identifiant de compte, jamais une adresse.';
comment on column public.auteurs_des_ouvertures.acces_id is
  'L''accès (memberships.id) ouvert ; sans clé étrangère : l''attestation survit au retrait de l''accès.';
comment on column public.auteurs_des_ouvertures.trace_id is
  'La ligne de la trace des droits (« acces », « creation », auteur nul) que l''attestation nomme ; sans clé étrangère, comme la trace.';
comment on column public.auteurs_des_ouvertures.auteur_id is
  'Le compte de la session qui a attesté (auth.uid() d''attester_ouverture_d_acces, jamais un paramètre) ; sans clé étrangère : l''attestation survit au départ du membre.';
comment on column public.auteurs_des_ouvertures.atteste_le is
  'L''instant de l''attestation, dans les cinq minutes de l''arrivée de l''accès.';

-- ══ 2. La garde ══════════
-- Aux droits de l'appelant : l'attestation (sous son réglage, qui nomme la ligne de la trace) ou la restauration du
-- super-administrateur écrivent ; rien ne se réécrit ; une ligne ne part qu'avec son dossier.
create function public.garder_auteurs_des_ouvertures() returns trigger
language plpgsql
set search_path = ''
as $fonction$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'L''auteur d''une ouverture d''accès ne se réécrit pas : il ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'L''auteur d''une ouverture d''accès ne se réécrit pas : il ne part qu''avec son dossier.' using errcode = '23514';
  end if;
  if coalesce(pg_catalog.current_setting('jd.auteur_d_une_ouverture', true), '') is distinct from new.trace_id::text
     and not public.is_super_admin() then
    raise exception 'L''auteur d''une ouverture d''accès ne s''écrit que par attester_ouverture_d_acces, sous la session du cabinet.'
      using errcode = '42501';
  end if;
  return new;
end
$fonction$;

comment on function public.garder_auteurs_des_ouvertures() is
  'Garde de auteurs_des_ouvertures (P1TQ2-Q1) : écrite par attester_ouverture_d_acces, sous le réglage qui nomme la ligne de la trace, ou par la restauration du super-administrateur (42501 sinon) ; ne se réécrit pas, ne part qu''avec son dossier (23514). Pour tout auteur ; aucun rôle de l''API ne l''exécute.';

create trigger auteurs_des_ouvertures_garde
  before insert or update or delete on public.auteurs_des_ouvertures
  for each row execute function public.garder_auteurs_des_ouvertures();

-- ══ 3. L'attestation du cabinet ══════════
-- Le cabinet du dossier, sous SA session, se nomme comme l'auteur de l'ouverture que l'Edge Function vient d'écrire. Le
-- contrôle vient d'abord, avant toute lecture.
create function public.attester_ouverture_d_acces(p_dossier_id uuid, p_acces_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fonction$
declare
  v_auteur uuid := auth.uid();
  v_trace uuid;
  v_le timestamptz;
begin
  if p_dossier_id is null or p_acces_id is null or v_auteur is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- L'arrivée de CET accès, qui est encore dans ce dossier et sous ce compte, écrite sans session dans les cinq dernières
  -- minutes, pas encore attestée, dont le titulaire n'est pas l'appelant ; la plus récente.
  select t.id into v_trace
    from public.trace_des_droits t
    join public.memberships m on m.id = t.acces_id and m.dossier_id = t.dossier_id and m.user_id = t.client_id
   where t.dossier_id = p_dossier_id and t.acces_id = p_acces_id
     and t.droit = 'acces' and t.geste = 'creation' and t.auteur_id is null
     and t.client_id <> v_auteur
     and t.fait_le >= pg_catalog.now() operator(pg_catalog.-) interval '5 minutes'
     and not exists (select 1 from public.auteurs_des_ouvertures a where a.trace_id = t.id)
   order by t.fait_le desc, t.id desc
   limit 1;
  if v_trace is null then
    raise exception 'Cette ouverture d''accès ne s''atteste pas : aucune arrivée de cet accès dans ce dossier, écrite sans session dans les cinq dernières minutes et pas encore attestée.'
      using errcode = '22023';
  end if;
  perform pg_catalog.set_config('jd.auteur_d_une_ouverture', v_trace::text, true);
  insert into public.auteurs_des_ouvertures (dossier_id, acces_id, trace_id, auteur_id)
  values (p_dossier_id, p_acces_id, v_trace, v_auteur)
  returning atteste_le into v_le;
  perform pg_catalog.set_config('jd.auteur_d_une_ouverture', '', true);
  return v_le;
end
$fonction$;

comment on function public.attester_ouverture_d_acces(uuid, uuid) is
  'Le cabinet du dossier (admin_du_dossier) se nomme comme l''auteur de l''ouverture d''un accès client que la trace a écrite sans session (P1TQ2-Q1) : auteur = auth.uid(), dans les cinq minutes de l''arrivée, une fois. 42501 sans le droit, avant toute lecture ; 22023 sans arrivée attestable. Appelée par l''Edge Function create-client-access sous la session de l''appelant.';

-- ══ 4. Les policies et les droits ══════════
alter table public.auteurs_des_ouvertures enable row level security;

create policy auteurs_des_ouvertures_lecture on public.auteurs_des_ouvertures
  for select to authenticated using (public.admin_du_dossier(dossier_id));

create policy auteurs_des_ouvertures_restauration on public.auteurs_des_ouvertures
  for insert to authenticated with check (public.is_super_admin());

do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    create policy deux_facteurs on public.auteurs_des_ouvertures as restrictive for all to authenticated
      using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()));
  end if;
end
$deux_facteurs$;

revoke all on function public.garder_auteurs_des_ouvertures() from public, anon, authenticated;
revoke all on function public.attester_ouverture_d_acces(uuid, uuid) from public, anon;
grant execute on function public.attester_ouverture_d_acces(uuid, uuid) to authenticated;

-- ══ 5. La garde de fin ══════════
-- Ce qui est posé, à l'empreinte de son corps et sous ses droits ; la garde, seul déclencheur de la table ; ses deux
-- policies (et la restrictive, si sa fonction est en base) ; aucune ligne.
do $fin$
begin
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p where p.oid = 'public.garder_auteurs_des_ouvertures()'::regprocedure), chr(13), ''))
       <> '6298dbb265626e86de5557a504011851'
     or (select p.prosecdef or p.proconfig is distinct from array['search_path=""'] from pg_catalog.pg_proc p
          where p.oid = 'public.garder_auteurs_des_ouvertures()'::regprocedure)
     or has_function_privilege('anon', 'public.garder_auteurs_des_ouvertures()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_auteurs_des_ouvertures()', 'execute') then
    raise exception 'Garde de fin : la garde de l''auteur d''une ouverture n''a pas le corps ou les droits attendus.';
  end if;
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p where p.oid = 'public.attester_ouverture_d_acces(uuid, uuid)'::regprocedure), chr(13), ''))
       <> '3a43ddacb2e7c663397dd1f61cb5194d'
     or not (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
              where p.oid = 'public.attester_ouverture_d_acces(uuid, uuid)'::regprocedure)
     or has_function_privilege('anon', 'public.attester_ouverture_d_acces(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.attester_ouverture_d_acces(uuid, uuid)', 'execute') then
    raise exception 'Garde de fin : l''attestation de l''ouverture n''a pas le corps ou les droits attendus.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname)
        from pg_catalog.pg_trigger t where t.tgrelid = 'public.auteurs_des_ouvertures'::regclass and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER auteurs_des_ouvertures_garde BEFORE INSERT OR DELETE OR UPDATE ON public.auteurs_des_ouvertures FOR EACH ROW EXECUTE FUNCTION garder_auteurs_des_ouvertures() O' then
    raise exception 'Garde de fin : la garde n''est pas le seul déclencheur de auteurs_des_ouvertures.';
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.auteurs_des_ouvertures'::regclass)
     or (select string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text, ',' order by p.polname)
           from pg_catalog.pg_policy p where p.polrelid = 'public.auteurs_des_ouvertures'::regclass
            and not (p.polname = 'deux_facteurs' and not p.polpermissive))
        is distinct from 'auteurs_des_ouvertures_lecture:r:true,auteurs_des_ouvertures_restauration:a:true' then
    raise exception 'Garde de fin : auteurs_des_ouvertures n''a pas sa RLS et ses deux policies.';
  end if;
  if exists (select 1 from public.auteurs_des_ouvertures) then
    raise exception 'Garde de fin : la table naît vide.';
  end if;
end
$fin$;
