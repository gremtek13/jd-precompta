-- Ligne 26.6, étape (d), suite : CE QUI A PRODUIT LES ÉCRITURES D'UN EXERCICE VALIDÉ EST FIGÉ AUSSI (décision du
-- cabinet, 04/10/2026). La 2035 se calcule depuis les sources (lib/declaration2035.ts) et non depuis les écritures :
-- figer les seules écritures laisserait une pièce corrigée après coup changer une 2035 déjà validée, sous des
-- écritures qui ne bougent plus. Chaque déclencheur refuse donc, pour ce qui appartient à un exercice validé, toute
-- modification et toute suppression — et l'insertion de ce qui y tomberait après coup —, en le disant.
--
-- QUI EST FIGÉ, et par quel critère :
--   - une PIÈCE qui porte une écriture validée, ou qui justifie un bien dont une écriture l'est : ses montants, sa
--     date, sa catégorie, son tiers et son fichier — pas ses notes, son sous-dossier ni la confiance de sa lecture,
--     qui ne comptent nulle part. Une pièce DÉPOSÉE après coup reste possible : c'est un document, et l'écriture
--     qu'elle demanderait, elle, ne passe plus la frontière ;
--   - un MOUVEMENT daté d'un exercice validé, et les parts de ses ventilations et de ses règlements groupés. La
--     validation refuse qu'un seul reste à traiter. Un mouvement de cette période ne s'importe plus — sauf s'il
--     y est déjà : la connexion bancaire réimporte une période en laissant la base écarter ce qu'elle connaît
--     (`on conflict do nothing`), et le déclencheur passe avant cet écart ;
--   - un BIEN qui porte une écriture validée (une dotation, ou l'acquisition par sa pièce) ; un bien acquis dans un
--     exercice validé ne s'inscrit plus au registre ;
--   - une ligne du CADRE 7 d'un exercice validé ;
--   - une ÉCHÉANCE de cotisation comptée dans un exercice validé — à la date du mouvement qui la paie, sinon à son
--     échéance, la règle de la 2035 (lib/cotisationRapprochee.ts) ;
--   - les À-NOUVEAUX du dossier, dès qu'un exercice est validé : ils ouvrent le premier exercice, qui se valide
--     avant tout autre, et une ouverture posée après des exercices validés les contredirait.
-- Les catégories et les natures restent libres : les écritures validées portent leur compte et son libellé, et la
-- 2035 validée est gardée telle qu'elle a été validée.
--
-- DEUX SORTIES, les mêmes que pour les écritures : la suppression du dossier entier, dont la cascade ne voit plus le
-- dossier (éprouvé sur une réplique locale), et l'insertion par le super-administrateur, qui restaure une
-- sauvegarde. Chaque déclencheur prend le verrou consultatif du dossier en partagé (voir `cle_validation`) : une
-- source modifiée pendant une validation attend qu'elle finisse, puis voit la frontière.

-- Le retour d'un déclencheur de ligne qui laisse passer.
create function public.retour_declencheur(p_op text, p_ancien anyelement, p_nouveau anyelement) returns anyelement
language sql immutable as $$
  select case when p_op = 'DELETE' then p_ancien else p_nouveau end
$$;

create function public.garder_piece_validee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_annee integer;
begin
  if not exists (select 1 from public.dossiers where id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
  select min(extract(year from e.date))::integer into v_annee
    from public.ecritures_brouillon e
   where e.statut = 'validee'
     and (e.piece_id = old.id
       or e.immobilisation_id in (select i.id from public.immobilisations i where i.piece_id = old.id));
  if v_annee is null then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Cette pièce justifie une écriture validée de l''exercice % : elle ne se supprime plus.', v_annee
      using errcode = '23514';
  end if;
  if (to_jsonb(new) - array['notes', 'sous_dossier_id', 'confiance', 'updated_at'])
     is distinct from (to_jsonb(old) - array['notes', 'sous_dossier_id', 'confiance', 'updated_at']) then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : ses montants, sa date et sa catégorie ne changent plus.',
      v_annee using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger pieces_figees_par_la_validation
  before update or delete on public.pieces
  for each row execute function public.garder_piece_validee();

create function public.garder_mouvement_valide() returns trigger
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
    if v_frontiere is not null and new.date <= v_frontiere and not public.is_super_admin()
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

create trigger lignes_bancaires_figees_par_la_validation
  before insert or update or delete on public.lignes_bancaires
  for each row execute function public.garder_mouvement_valide();

-- Les parts d'une ventilation ou d'un règlement groupé suivent leur mouvement.
create function public.garder_parts_mouvement_valide() returns trigger
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
  if tg_op = 'INSERT' and public.is_super_admin() then
    return new;
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

create trigger ventilations_bancaires_figees_par_la_validation
  before insert or update or delete on public.ventilations_bancaires
  for each row execute function public.garder_parts_mouvement_valide();
create trigger reglements_groupes_figes_par_la_validation
  before insert or update or delete on public.reglements_groupes
  for each row execute function public.garder_parts_mouvement_valide();

create function public.garder_bien_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_annee integer;
begin
  if tg_op = 'INSERT' then
    if public.is_super_admin() then
      return new;
    end if;
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

create trigger immobilisations_figees_par_la_validation
  before insert or update or delete on public.immobilisations
  for each row execute function public.garder_bien_valide();

create function public.garder_vehicule_valide() returns trigger
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
  if tg_op = 'INSERT' and public.is_super_admin() then
    return new;
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

create trigger vehicules_figes_par_la_validation
  before insert or update or delete on public.vehicules
  for each row execute function public.garder_vehicule_valide();

-- Une échéance compte à la date du mouvement qui la paie, sinon à son échéance (lib/cotisationRapprochee.ts) : c'est
-- cette date qui dit si elle appartient à un exercice validé.
create function public.garder_cotisation_valide() returns trigger
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
  if tg_op = 'INSERT' and public.is_super_admin() then
    return new;
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

create trigger cotisations_declarees_figees_par_la_validation
  before insert or update or delete on public.cotisations_declarees
  for each row execute function public.garder_cotisation_valide();

create function public.garder_a_nouveaux_valides() returns trigger
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
  if tg_op = 'INSERT' and public.is_super_admin() then
    return new;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(v_dossier));
  v_frontiere := public.frontiere_validation(v_dossier);
  if v_frontiere is not null then
    raise exception 'Un exercice de ce dossier est validé : son ouverture ne change plus.' using errcode = '23514';
  end if;
  return public.retour_declencheur(tg_op, old, new);
end;
$$;

create trigger a_nouveaux_figes_par_la_validation
  before insert or update or delete on public.a_nouveaux
  for each row execute function public.garder_a_nouveaux_valides();

revoke execute on function public.retour_declencheur(text, anyelement, anyelement) from public, anon, authenticated;
revoke execute on function public.garder_piece_validee() from public, anon, authenticated;
revoke execute on function public.garder_mouvement_valide() from public, anon, authenticated;
revoke execute on function public.garder_parts_mouvement_valide() from public, anon, authenticated;
revoke execute on function public.garder_bien_valide() from public, anon, authenticated;
revoke execute on function public.garder_vehicule_valide() from public, anon, authenticated;
revoke execute on function public.garder_cotisation_valide() from public, anon, authenticated;
revoke execute on function public.garder_a_nouveaux_valides() from public, anon, authenticated;
