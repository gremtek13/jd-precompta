-- LE RETOUR DE `trois_cases_de_l_acces` (étape B1) : la base d'avant — celle que `situations_publiees` (C4a) laisse —, au
-- caractère près des corps qu'elle avait. DESTRUCTIF (trois colonnes et la forme à huit retirées) : il se COLLE dans
-- l'éditeur SQL, dans une transaction, sur l'accord explicite du cabinet. Il se refuse tant qu'un accès porte l'une des
-- trois cases (une case que le cabinet a cochée : la décocher d'abord, de sa fonction), ou qu'une fonction d'une étape
-- d'après (B2, B4, B7) les lit. Les lignes de la trace qui les racontent restent : la contrainte de P1-trace admet leurs
-- mots, et la trace survit à ce qu'elle raconte.
do $garde$
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and not a.attisdropped
                  and a.attname in ('droit_achats', 'droit_frais', 'droit_documents'))
     or to_regprocedure('public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean)') is null then
    raise exception 'La migration trois_cases_de_l_acces n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if exists (select 1 from public.memberships m where m.droit_achats or m.droit_frais or m.droit_documents) then
    raise exception 'Un accès porte la case « Achats », « Notes de frais » ou « Documents » : la décocher d''abord (changer_droits_acces). Rien n''est défait.';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname not in ('client_du_dossier', 'droits_sur_le_dossier', 'changer_droits_acces', 'tracer_les_droits')
              and (p.prosrc like '%droit_achats%' or p.prosrc like '%droit_frais%' or p.prosrc like '%droit_documents%'
                   or p.prosrc ~ 'client_du_dossier[(][^)]*''(achats|frais|documents)'''))
     or exists (select 1 from pg_policies p where p.schemaname = 'public'
                 and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ '''(achats|frais|documents)''') then
    raise exception 'Une fonction ou une policy d''une étape d''après lit les trois cases : défaire d''abord cette étape. Rien n''est défait.';
  end if;
end
$garde$;

-- La trace de C4a, avant que les colonnes ne partent : son déclencheur les nomme.
create or replace function public.tracer_les_droits() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur uuid := auth.uid();
  v_droits constant text[] := array['ventes', 'banque', 'caisse', 'comptes'];
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
    v_avant := array[old.droit_ventes, old.droit_banque, old.droit_caisse, old.droit_comptes];
  end if;
  if tg_op <> 'DELETE' then
    v_apres := array[new.droit_ventes, new.droit_banque, new.droit_caisse, new.droit_comptes];
  end if;
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id and new.user_id = old.user_id then
    -- Le même accès : une ligne par case qui change.
    perform set_config('jd.trace_des_droits', new.id::text, true);
    for i in 1 .. 4 loop
      if v_avant[i] is distinct from v_apres[i] then
        insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
        values (new.dossier_id, new.id, new.user_id, v_droits[i], v_apres[i], 'changement', v_auteur);
      end if;
    end loop;
  else
    -- Un accès qui part (retiré, ou emporté vers un autre dossier ou un autre compte) : ses cases cochées, en « retrait ».
    if tg_op <> 'INSERT' then
      perform set_config('jd.trace_des_droits', old.id::text, true);
      for i in 1 .. 4 loop
        if v_avant[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (old.dossier_id, old.id, old.user_id, v_droits[i], false, 'retrait', v_auteur);
        end if;
      end loop;
    end if;
    -- Un accès qui arrive (inséré, ou emporté depuis un autre dossier ou un autre compte) : ses cases cochées, en « creation ».
    if tg_op <> 'DELETE' then
      perform set_config('jd.trace_des_droits', new.id::text, true);
      for i in 1 .. 4 loop
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
  after insert or update of droit_ventes, droit_banque, droit_caisse, droit_comptes,
    dossier_id, user_id, id or delete on public.memberships
  for each row execute function public.tracer_les_droits();

comment on table public.trace_des_droits is
  'La trace des droits « Ventes », « Banque », « Caisse » et « Comptes » des accès client d''un dossier : qui a coché ou décoché quelle case, et quand (étape P1-trace). Écrite par le déclencheur tracer_les_droits seul, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien.';

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
            when 'comptes' then m.droit_comptes
            else false
          end
  )
$$;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », « caisse », « comptes », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';

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
    'caisse', public.gere_la_caisse(p_dossier_id),
    'comptes', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'comptes')
  )
$$;

comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque, caisse, comptes}. N''écrit rien.';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean,
  p_comptes boolean)
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
  if p_ventes is null and p_banque is null and p_caisse is null and p_comptes is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque », « Caisse » ou « Comptes ».' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque),
         droit_caisse = coalesce(p_caisse, m.droit_caisse),
         droit_comptes = coalesce(p_comptes, m.droit_comptes)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean) is
  'Change les droits « Ventes », « Banque », « Caisse » et « Comptes » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces quatre colonnes ; rend l''accès tel que l''écriture l''a laissé (espace client, étape C4a).';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, p_caisse, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean) is
  'La forme à quatre paramètres de changer_droits_acces : « Ventes », « Banque » et « Caisse », « Comptes » inchangé — un appel de la forme à cinq, qui seule écrit memberships (espace client, étape C4a).';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'La forme à trois paramètres de changer_droits_acces : « Ventes » et « Banque », « Caisse » et « Comptes » inchangés — un appel de la forme à cinq, qui seule écrit memberships (espace client, étape C4a).';

drop function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean);

alter table public.memberships
  drop column droit_achats,
  drop column droit_frais,
  drop column droit_documents;
