-- LE RETOUR DE `situations_publiees` (étape C4a) : la base d'avant, au caractère près des corps qu'elle avait. DESTRUCTIF
-- (la table, la colonne, cinq fonctions retirées) : il se COLLE dans l'éditeur SQL, dans une transaction, sur l'accord
-- explicite du cabinet. Il se refuse tant qu'une situation est publiée ou qu'un accès porte la case « Comptes » : il
-- détruirait ce que le client a lu, ou une case que le cabinet a cochée — on les retire d'abord, de leurs fonctions.
do $garde$
begin
  if to_regclass('public.situations_publiees') is null then
    raise exception 'La migration situations_publiees n''est pas en base : rien à défaire.';
  end if;
  if exists (select 1 from public.situations_publiees) then
    raise exception 'Une situation est publiée : le retour la détruirait. Rien n''est défait.';
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

alter table public.memberships drop column droit_comptes;
