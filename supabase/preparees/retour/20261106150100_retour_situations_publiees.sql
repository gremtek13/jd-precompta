-- LE RETOUR DE `situations_publiees` (étape C4a) : la base d'avant, au caractère près des corps qu'elle avait. DESTRUCTIF
-- (la table, la colonne, cinq fonctions retirées) : il se COLLE dans l'éditeur SQL, dans une transaction, sur l'accord
-- explicite du cabinet. Il se refuse tant qu'une situation est publiée ou qu'un accès porte la case « Comptes » : il
-- détruirait ce que le client a lu, ou une case que le cabinet a cochée — on les retire d'abord, de leurs fonctions.
-- La migration : supabase/schema/20261107164102_situations_publiees.sql (en production depuis le 07/11/2026).
do $garde$
begin
  if to_regclass('public.situations_publiees') is null then
    raise exception 'La migration situations_publiees n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from public.situations_publiees) then
    raise exception 'Une situation est publiée : le retour la détruirait. Rien n''est défait.';
  end if;
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and not a.attisdropped
              and a.attname in ('droit_achats', 'droit_frais', 'droit_documents')) then
    raise exception 'La migration trois_cases_de_l_acces (B1) est en base, qui reprend les fonctions de celle-ci : la défaire d''abord. Rien n''est défait.';
  end if;
  if exists (select 1 from public.memberships m where m.droit_comptes) then
    raise exception 'Un accès porte la case « Comptes » : la décocher d''abord (changer_droits_acces). Rien n''est défait.';
  end if;
end
$garde$;

drop function public.publier_situation(uuid, date, jsonb, uuid);
drop function public.retirer_situation(uuid);
drop table public.situations_publiees;
drop function public.situation_publiee_en_cours(uuid);
drop function public.refus_des_chiffres_de_la_situation(jsonb, date, date);
drop function public.garder_situation_publiee();

-- Les formes à trois et à quatre de `caisse_du_client`, au caractère près, avant de retirer la forme à cinq.
create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'La forme à trois paramètres de changer_droits_acces : « Ventes » et « Banque », « Caisse » inchangé — un appel de la forme à quatre, qui seule écrit memberships (ligne 26.6, étape C10).';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dossier uuid;
  v_acces public.memberships;
begin
  select m.dossier_id into v_dossier from public.memberships m where m.id = p_membership_id;
  if v_dossier is null or not public.admin_du_dossier(v_dossier) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_ventes is null and p_banque is null and p_caisse is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque » ou « Caisse ».' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque),
         droit_caisse = coalesce(p_caisse, m.droit_caisse)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean) is
  'Change les droits « Ventes », « Banque » et « Caisse » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces trois colonnes ; rend l''accès tel que l''écriture l''a laissé (ligne 26.6, étape C10).';

drop function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean);

create or replace function public.droits_sur_le_dossier(p_dossier_id uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'cabinet', public.admin_du_dossier(p_dossier_id),
    'membre', public.client_du_dossier(p_dossier_id, 'membre'),
    'ventes', public.gere_les_ventes(p_dossier_id),
    'banque', public.gere_la_banque(p_dossier_id),
    'caisse', public.gere_la_caisse(p_dossier_id)
  )
$$;

comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque, caisse}. N''écrit rien.';

create or replace function public.client_du_dossier(p_dossier_id uuid, p_droit text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.dossier_id = p_dossier_id
      and m.user_id = auth.uid()
      and case p_droit
            when 'membre' then true
            when 'ventes' then m.droit_ventes
            when 'banque' then m.droit_banque
            when 'caisse' then m.droit_caisse
            else false
          end
  )
$$;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », « caisse », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';

-- La trace des droits de P1-trace, au caractère près, avant que la colonne ne parte : son déclencheur la nomme. Les lignes
-- de « comptes » déjà tracées restent (la contrainte de P1-trace admet le mot).
create or replace function public.tracer_les_droits() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur uuid := auth.uid();
  v_droits constant text[] := array['ventes', 'banque', 'caisse'];
  v_avant boolean[];
  v_apres boolean[];
  i integer;
begin
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, puis sa trace. Sa mise à jour et son
  -- retrait d'un accès, si.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le retrait d'un accès par la suppression de son dossier : le dossier n'est déjà plus là, sa trace part avec lui.
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    v_avant := array[old.droit_ventes, old.droit_banque, old.droit_caisse];
  end if;
  if tg_op <> 'DELETE' then
    v_apres := array[new.droit_ventes, new.droit_banque, new.droit_caisse];
  end if;
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id and new.user_id = old.user_id then
    -- Le même accès : une ligne par case qui change.
    perform set_config('jd.trace_des_droits', new.id::text, true);
    for i in 1 .. 3 loop
      if v_avant[i] is distinct from v_apres[i] then
        insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
        values (new.dossier_id, new.id, new.user_id, v_droits[i], v_apres[i], 'changement', v_auteur);
      end if;
    end loop;
  else
    -- Un accès qui part (retiré, ou emporté vers un autre dossier ou un autre compte) : ses cases cochées, en « retrait ».
    if tg_op <> 'INSERT' then
      perform set_config('jd.trace_des_droits', old.id::text, true);
      for i in 1 .. 3 loop
        if v_avant[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (old.dossier_id, old.id, old.user_id, v_droits[i], false, 'retrait', v_auteur);
        end if;
      end loop;
    end if;
    -- Un accès qui arrive (inséré, ou emporté depuis un autre dossier ou un autre compte) : ses cases cochées, en « creation ».
    if tg_op <> 'DELETE' then
      perform set_config('jd.trace_des_droits', new.id::text, true);
      for i in 1 .. 3 loop
        if v_apres[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (new.dossier_id, new.id, new.user_id, v_droits[i], true, 'creation', v_auteur);
        end if;
      end loop;
    end if;
  end if;
  perform set_config('jd.trace_des_droits', '', true);
  return null;
end
$$;

create or replace trigger memberships_trace_des_droits
  after insert or update of droit_ventes, droit_banque, droit_caisse, dossier_id, user_id, id or delete on public.memberships
  for each row execute function public.tracer_les_droits();

comment on table public.trace_des_droits is
  'La trace des droits « Ventes », « Banque » et « Caisse » des accès client d''un dossier : qui a coché ou décoché quelle case, et quand (étape P1-trace). Écrite par le déclencheur tracer_les_droits seul, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien.';

alter table public.memberships drop column droit_comptes;
