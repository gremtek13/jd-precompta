-- Ligne 26.6, étape (d), suite : LA RESTAURATION D'UNE SAUVEGARDE N'OUVRE PLUS UN EXERCICE VALIDÉ. Les deux
-- migrations précédentes laissaient le super-administrateur insérer ce qu'un exercice validé refuse — un
-- mouvement, une part, un bien, une ligne du cadre 7, une échéance, des à-nouveaux, une écriture déjà validée —,
-- pour que la restauration d'une sauvegarde puisse remettre un dossier tel qu'il était. Or sur ce projet le
-- super-administrateur est aussi le chef du cabinet : l'exception lui laissait importer un relevé dans un exercice
-- validé, par l'écran ordinaire, sans que rien ne le refuse. Trouvé en écrivant l'essai de production, le
-- 04/10/2026, avant qu'aucun exercice ne soit validé.
--
-- L'exception n'était pas nécessaire : la restauration réinsère les exercices validés EN DERNIER (après les
-- écritures, `ORDRE_RESTAURATION` dans src/lib/sauvegarde.ts). Tant qu'ils n'y sont pas, aucune frontière n'existe
-- pour ce dossier, et ses sources se réinsèrent comme n'importe quelles lignes. Seule une écriture DÉJÀ VALIDÉE a
-- besoin d'une porte — elle ne devient « validée » que par `valider_exercice` —, et cette porte ne s'ouvre plus
-- qu'au super-administrateur, sur un dossier qui ne porte encore aucun exercice validé : le cas de la
-- restauration, et lui seul. Une fois les exercices validés réinsérés, plus rien n'entre.

create or replace function public.garder_ecritures_validees() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return old;
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    if old.statut = 'validee' then
      raise exception 'Cette écriture est validée (exercice %) : elle ne se supprime plus.',
        extract(year from old.date)::integer using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return new;
    end if;
    if old.statut = 'validee' then
      raise exception 'Cette écriture est validée (exercice %) : elle ne se modifie plus.',
        extract(year from old.date)::integer using errcode = '23514';
    end if;
  end if;

  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  if new.statut = 'validee' then
    if tg_op = 'INSERT' and public.is_super_admin()
       and not exists (select 1 from public.exercices_valides where dossier_id = new.dossier_id) then
      return new;
    end if;
    if coalesce(current_setting('jd.validation_exercice', true), '') is distinct from new.dossier_id::text then
      raise exception 'Une écriture ne se valide que par la validation de son exercice.' using errcode = '42501';
    end if;
    return new;
  end if;

  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.date <= v_frontiere then
    raise exception 'L''exercice % est validé : aucune écriture ne s''y passe plus.', extract(year from new.date)::integer
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.garder_mouvement_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_frontiere := public.frontiere_validation(new.dossier_id);
    if v_frontiere is not null and new.date <= v_frontiere
       and not (new.id_externe is not null and exists (
         select 1 from public.lignes_bancaires where dossier_id = new.dossier_id and id_externe = new.id_externe)) then
      raise exception 'L''exercice % est validé : un mouvement de cet exercice ne s''importe plus.',
        extract(year from new.date)::integer using errcode = '23514';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
  v_frontiere := public.frontiere_validation(old.dossier_id);
  if v_frontiere is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if old.date <= v_frontiere then
    if tg_op = 'DELETE' then
      raise exception 'L''exercice % est validé : ce mouvement ne se supprime plus.', extract(year from old.date)::integer
        using errcode = '23514';
    end if;
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'L''exercice % est validé : ce mouvement ne change plus.', extract(year from old.date)::integer
        using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' and new.date <= v_frontiere then
    raise exception 'L''exercice % est validé : un mouvement ne s''y déplace plus.', extract(year from new.date)::integer
      using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;

create or replace function public.garder_parts_mouvement_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_frontiere date;
  v_date date;
begin
  v_dossier := case when tg_op = 'INSERT' then new.dossier_id else old.dossier_id end;
  if not exists (select 1 from public.dossiers where id = v_dossier) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier));
  v_frontiere := public.frontiere_validation(v_dossier);
  if v_frontiere is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  select min(l.date) into v_date from public.lignes_bancaires l
   where l.id in (case when tg_op = 'INSERT' then null else old.ligne_bancaire_id end,
                  case when tg_op = 'DELETE' then null else new.ligne_bancaire_id end);
  if v_date <= v_frontiere then
    raise exception 'L''exercice % est validé : la répartition de ce mouvement ne change plus.', extract(year from v_date)::integer
      using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;

create or replace function public.garder_bien_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_annee integer;
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
    v_frontiere := public.frontiere_validation(new.dossier_id);
    if v_frontiere is not null and new.date_acquisition <= v_frontiere then
      raise exception 'L''exercice % est validé : un bien acquis dans cet exercice ne s''inscrit plus au registre.',
        extract(year from new.date_acquisition)::integer using errcode = '23514';
    end if;
    if new.piece_id is not null and exists (
      select 1 from public.ecritures_brouillon where piece_id = new.piece_id and statut = 'validee'
    ) then
      raise exception 'Cette pièce porte une écriture validée : elle ne devient plus une immobilisation.' using errcode = '23514';
    end if;
    return new;
  end if;
  if not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
  select min(extract(year from e.date))::integer into v_annee
    from public.ecritures_brouillon e
   where e.statut = 'validee'
     and (e.immobilisation_id = old.id or (old.piece_id is not null and e.piece_id = old.piece_id));
  if v_annee is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Ce bien porte une écriture validée de l''exercice % : il ne se retire plus du registre.', v_annee
      using errcode = '23514';
  end if;
  if to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Ce bien porte une écriture validée de l''exercice % : sa valeur, ses dates et sa durée ne changent plus.',
      v_annee using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.garder_vehicule_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_derniere integer;
begin
  v_dossier := case when tg_op = 'INSERT' then new.dossier_id else old.dossier_id end;
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers where id = v_dossier) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier));
  v_derniere := extract(year from public.frontiere_validation(v_dossier))::integer;
  if v_derniere is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op <> 'INSERT' and old.annee <= v_derniere then
    if tg_op = 'DELETE' then
      raise exception 'L''exercice % est validé : son cadre 7 ne change plus.', old.annee using errcode = '23514';
    end if;
    if (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
      raise exception 'L''exercice % est validé : son cadre 7 ne change plus.', old.annee using errcode = '23514';
    end if;
  elsif tg_op <> 'DELETE' and new.annee <= v_derniere then
    raise exception 'L''exercice % est validé : son cadre 7 ne change plus.', new.annee using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;

create or replace function public.garder_cotisation_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_frontiere date;
  v_date date;
begin
  v_dossier := case when tg_op = 'INSERT' then new.dossier_id else old.dossier_id end;
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers where id = v_dossier) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier));
  v_frontiere := public.frontiere_validation(v_dossier);
  if v_frontiere is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op <> 'INSERT' then
    v_date := coalesce((select l.date from public.lignes_bancaires l where l.cotisation_id = old.id), old.echeance);
    if v_date <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception 'L''exercice % est validé : cette échéance ne se supprime plus.', extract(year from v_date)::integer
          using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception 'L''exercice % est validé : cette échéance ne change plus.', extract(year from v_date)::integer
          using errcode = '23514';
      end if;
      return new;
    end if;
  end if;
  if tg_op <> 'DELETE' and new.echeance <= v_frontiere
     and not exists (select 1 from public.lignes_bancaires l where l.cotisation_id = new.id) then
    raise exception 'L''exercice % est validé : une échéance ne s''y ajoute plus.', extract(year from new.echeance)::integer
      using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;

create or replace function public.garder_a_nouveaux_valides() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid;
  v_frontiere date;
begin
  v_dossier := case when tg_op = 'INSERT' then new.dossier_id else old.dossier_id end;
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers where id = v_dossier) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier));
  v_frontiere := public.frontiere_validation(v_dossier);
  if v_frontiere is not null then
    raise exception 'Un exercice de ce dossier est validé : son ouverture ne change plus.' using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;
