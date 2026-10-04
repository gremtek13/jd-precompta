-- Ligne 26.6, étape (d), suite : CE QUE DIT UN REFUS À LA FRONTIÈRE, ET CE QU'UNE MODIFICATION Y FAIT ENTRER. Deux
-- défauts trouvés en écrivant l'essai de production, le 04/10/2026, avant qu'aucun exercice ne soit validé.
--
-- 1. LES REFUS NOMMAIENT VALIDÉ UN EXERCICE QUI NE L'A JAMAIS ÉTÉ. La frontière est le 31 décembre du dernier
--    exercice validé, et tout ce qui la précède est figé — y compris ce qui précède le PREMIER exercice validé. Un
--    dossier repris au 1er janvier 2025 et validé pour 2025 refusait un relevé de 2024 en disant « L'exercice 2024
--    est validé », ce qui est faux : 2024 est dans les comptes repris. Un refus nomme désormais l'exercice validé
--    qui fige la date (`exercice_fige`). Et la validation qui trouvait au brouillon des écritures antérieures à
--    l'ouverture du dossier conseillait de valider d'abord leur exercice, qu'elle refuse ensuite de valider : elle
--    dit maintenant de les retirer ou de les redater, comme elle disait déjà d'ignorer les mouvements de cette
--    période.
--
-- 2. UNE MODIFICATION FAISAIT ENTRER DANS UN EXERCICE VALIDÉ CE QU'UNE INSERTION Y REFUSE. Une modification retire
--    l'ancienne ligne et pose la nouvelle : les déclencheurs gardaient la première moitié et, selon la table, pas la
--    seconde. La date d'acquisition d'un bien avancée dans un exercice validé — l'écran « Modifier » le permet — et
--    la pièce d'un bien remplacée par une pièce dont l'écriture est validée échappaient au refus que le même bien
--    inscrit aurait reçu ; et une ligne passée d'un dossier à l'autre — mouvement, part, ligne du cadre 7,
--    échéance, à-nouveau — n'était jugée que sur la frontière du dossier qu'elle quittait. Aucun écran ne fait
--    changer une ligne de dossier ; un appel direct le pouvait, et la validation n'est une garantie que si rien ne
--    la contourne. La nouvelle ligne est maintenant jugée comme une insertion, sur la frontière de SON dossier, et
--    une écriture qui quitte un dossier attend que sa validation finisse.

-- Ce qu'un refus dit de l'exercice d'une date figée : « validé » quand il l'est, sinon l'exercice validé qui le fige.
create function public.exercice_fige(p_dossier_id uuid, p_annee integer) returns text
language sql stable set search_path = public as $$
  select case
    when exists (select 1 from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee = p_annee)
      then format('L''exercice %s est validé', p_annee)
    else format('L''exercice %s est figé par la validation de l''exercice %s', p_annee,
      (select min(v.annee) from public.exercices_valides v where v.dossier_id = p_dossier_id and v.annee > p_annee))
  end
$$;

revoke execute on function public.exercice_fige(uuid, integer) from public, anon, authenticated;

create or replace function public.valider_exercice(
  p_dossier_id uuid,
  p_annee integer,
  p_lignes jsonb,
  p_a_nouveaux jsonb,
  p_declaration jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cabinet uuid;
  v_mode text;
  v_debut date;
  v_fin date;
  v_ouverture date;
  v_anterieur integer;
  v_attendues integer;
  v_recues integer;
  v_distinctes integer;
  v_jointes integer;
  v_an_attendus integer;
  v_an_recus integer;
  v_an_distincts integer;
  v_an_joints integer;
  v_a_traiter integer;
  v_derniere integer;
  v_defaut text;
  v_maintenant timestamptz := now();
  v_precedente text;
  v_empreinte text;
  v_debit numeric;
  v_credit numeric;
  v_ecritures integer;
  v_lignes integer;
begin
  select cabinet_id, mode_comptable into v_cabinet, v_mode from public.dossiers where id = p_dossier_id;
  if not found or not public.est_chef_du_cabinet(v_cabinet) then
    raise exception 'Seul le chef du cabinet valide un exercice.' using errcode = '42501';
  end if;
  if p_annee is null or p_annee < 2000 or p_annee > 2100 then
    raise exception 'Exercice invalide.' using errcode = '22023';
  end if;
  -- Exclusif : aucune écriture ni aucune source ne change pendant la validation (voir `cle_validation`).
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  v_debut := make_date(p_annee, 1, 1);
  v_fin := make_date(p_annee, 12, 31);
  -- L'année se lit à Paris, comme dans l'application : la nuit du 1er janvier ne doit pas les faire diverger.
  if p_annee >= extract(year from (now() at time zone 'Europe/Paris'))::integer then
    raise exception 'L''exercice % n''est pas terminé : il se valide une fois clos.', p_annee using errcode = '22023';
  end if;
  if exists (select 1 from public.exercices_valides where dossier_id = p_dossier_id and annee >= p_annee) then
    raise exception 'L''exercice % est déjà validé, ou un exercice postérieur l''est.', p_annee using errcode = '23514';
  end if;
  -- Après le premier, chaque exercice suit le précédent : un exercice sauté serait figé par la frontière sans
  -- qu'aucune validation ne l'ait regardé.
  select max(annee) into v_derniere from public.exercices_valides where dossier_id = p_dossier_id;
  if v_derniere is not null and p_annee <> v_derniere + 1 then
    raise exception 'L''exercice % n''est pas validé : les exercices se valident dans l''ordre.', v_derniere + 1
      using errcode = '23514';
  end if;
  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = p_dossier_id;
  if v_ouverture is not null and v_fin < v_ouverture then
    raise exception 'L''exercice % précède l''ouverture du dossier : il est dans les comptes repris.', p_annee
      using errcode = '22023';
  end if;
  -- Les à-nouveaux ouvrent le premier exercice du dossier, qui se valide avant tout autre : sans quoi la frontière
  -- les figerait sans qu'aucun exercice validé ne les porte.
  if v_ouverture is not null and v_ouverture < v_debut and not exists (
    select 1 from public.exercices_valides
     where dossier_id = p_dossier_id and annee = extract(year from v_ouverture)::integer
  ) then
    raise exception 'L''exercice % porte les à-nouveaux du dossier : il se valide d''abord.',
      extract(year from v_ouverture)::integer using errcode = '23514';
  end if;
  select min(extract(year from date))::integer into v_anterieur
    from public.ecritures_brouillon where dossier_id = p_dossier_id and date < v_debut and statut = 'proposee';
  if v_anterieur is not null then
    -- Leur exercice ne se validera jamais : il précède l'ouverture, et les comptes repris portent cette période.
    if v_ouverture is not null and v_anterieur < extract(year from v_ouverture)::integer then
      raise exception 'Des écritures antérieures à l''ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.',
      v_anterieur using errcode = '23514';
  end if;
  -- Un mouvement daté d'un exercice validé ne change plus (migration `sources_figees_par_la_validation`) : encore
  -- à traiter, il le resterait.
  select min(extract(year from date))::integer into v_a_traiter
    from public.lignes_bancaires where dossier_id = p_dossier_id and date <= v_fin and statut = 'non_rapprochee';
  if v_a_traiter is not null then
    if v_ouverture is not null and v_a_traiter < extract(year from v_ouverture)::integer then
      raise exception 'Des mouvements bancaires antérieurs à l''ouverture du dossier restent à traiter : les ignorer avant la validation.'
        using errcode = '23514';
    end if;
    raise exception 'L''exercice % porte des mouvements bancaires à traiter : ils se traitent avant la validation.', v_a_traiter
      using errcode = '23514';
  end if;
  if (v_mode = 'tresorerie') <> (jsonb_typeof(p_declaration) is not distinct from 'object') then
    raise exception '%', case when v_mode = 'tresorerie' then 'La 2035 à valider manque.'
      else 'Un dossier tenu en engagement n''a pas de 2035.' end using errcode = '22023';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' then
    raise exception 'La numérotation proposée est illisible.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_a_nouveaux) is distinct from 'array' then
    raise exception 'Les libellés proposés des à-nouveaux sont illisibles.' using errcode = '22023';
  end if;

  with l as (
    select * from jsonb_to_recordset(p_lignes) as x(id uuid, journal text, numero integer, piece_ref text,
      piece_date date, compte_lib text, comp_aux_num text, comp_aux_lib text)
  ), e as (
    select id, date, compte, montant, sens from public.ecritures_brouillon
    where dossier_id = p_dossier_id and date between v_debut and v_fin
  ), j as (
    select l.*, e.date, e.compte, e.montant, e.sens from l join e on e.id = l.id
  ), groupes as (
    select journal, numero, min(date) as premiere,
      sum(case when sens = 'debit' then montant else -montant end) as solde,
      count(distinct piece_ref) as refs, count(distinct piece_date) as dates
    from j group by journal, numero
  ), journaux as (
    select journal, min(numero) as premier, max(numero) as dernier, count(*) as nb from groupes group by journal
  ), an_l as (
    select * from jsonb_to_recordset(p_a_nouveaux) as x(id uuid, compte_lib text, ecriture_lib text)
  ), an_e as (
    select id, compte from public.a_nouveaux where dossier_id = p_dossier_id and date between v_debut and v_fin
  ), an_j as (
    select an_l.*, an_e.compte from an_l join an_e on an_e.id = an_l.id
  )
  select
    (select count(*) from e), (select count(*) from l), (select count(distinct id) from l), (select count(*) from j),
    (select count(*) from an_e), (select count(*) from an_l), (select count(distinct id) from an_l),
    (select count(*) from an_j),
    case
      when exists (select 1 from l where journal is null or journal not in ('AC', 'VE', 'BQ', 'OD')
          or numero is null or numero < 1 or coalesce(btrim(piece_ref), '') = '' or piece_date is null
          or coalesce(btrim(compte_lib), '') = '' or (comp_aux_num is null) <> (comp_aux_lib is null)
          or (comp_aux_num is not null and (btrim(comp_aux_num) = '' or btrim(comp_aux_lib) = '')))
        then 'Une ligne de la numérotation proposée est incomplète.'
      when exists (select 1 from an_l where coalesce(btrim(compte_lib), '') = '' or coalesce(btrim(ecriture_lib), '') = '')
        then 'Un à-nouveau proposé est incomplet.'
      when exists (select 1 from journaux where premier <> 1 or dernier <> nb)
        then 'Les numéros d''un journal ne se suivent pas.'
      when exists (select 1 from (
          select premiere, lag(premiere) over (partition by journal order by numero) as avant from groupes) z
          where avant > premiere)
        then 'Les numéros d''un journal ne suivent pas l''ordre des dates.'
      when exists (select 1 from groupes where solde <> 0)
        then 'Une écriture n''est pas équilibrée au centime.'
      when exists (select 1 from groupes where refs <> 1 or dates <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même pièce.'
      when exists (select 1 from (select compte, compte_lib from j union all select compte, compte_lib from an_j) c
          group by compte having count(distinct compte_lib) > 1)
        then 'Un même compte porte deux libellés.'
      when exists (select 1 from j where comp_aux_num is not null group by comp_aux_num having count(distinct comp_aux_lib) > 1)
        then 'Un même compte auxiliaire porte deux libellés.'
    end
  into v_attendues, v_recues, v_distinctes, v_jointes, v_an_attendus, v_an_recus, v_an_distincts, v_an_joints, v_defaut;

  if v_recues <> v_distinctes or v_recues <> v_attendues or v_jointes <> v_recues then
    raise exception 'La numérotation proposée ne couvre pas exactement les % écritures de l''exercice %.', v_attendues, p_annee
      using errcode = '22023';
  end if;
  if v_an_recus <> v_an_distincts or v_an_recus <> v_an_attendus or v_an_joints <> v_an_recus then
    raise exception 'Les libellés proposés ne couvrent pas exactement les % à-nouveaux de l''exercice %.', v_an_attendus, p_annee
      using errcode = '22023';
  end if;
  if v_defaut is not null then
    raise exception '%', v_defaut using errcode = '22023';
  end if;

  -- Le déclencheur d'intangibilité ne laisse passer « validée » qu'à cette fonction, pour ce dossier.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  update public.ecritures_brouillon e
     set statut = 'validee', valide_le = v_maintenant, journal_code = l.journal, numero_ecriture = l.numero,
         piece_ref = l.piece_ref, piece_date = l.piece_date, compte_lib = l.compte_lib,
         comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib
    from jsonb_to_recordset(p_lignes) as l(id uuid, journal text, numero integer, piece_ref text, piece_date date,
      compte_lib text, comp_aux_num text, comp_aux_lib text)
   where e.id = l.id and e.dossier_id = p_dossier_id;
  perform set_config('jd.validation_exercice', '', true);
  update public.a_nouveaux a set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where a.id = l.id and a.dossier_id = p_dossier_id;

  if exists (select 1 from public.ecritures_brouillon where dossier_id = p_dossier_id and date <= v_fin and statut = 'proposee') then
    raise exception 'Une écriture de l''exercice % n''a pas été validée.', p_annee using errcode = '23514';
  end if;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0), coalesce(sum(montant) filter (where sens = 'credit'), 0),
         count(distinct (journal_code, numero_ecriture)), count(*)
    into v_debit, v_credit, v_ecritures, v_lignes
    from public.ecritures_brouillon
   where dossier_id = p_dossier_id and statut = 'validee' and date between v_debut and v_fin;
  select empreinte into v_precedente from public.exercices_valides
   where dossier_id = p_dossier_id and annee < p_annee order by annee desc limit 1;
  v_empreinte := public.empreinte_exercice(p_dossier_id, p_annee, v_precedente);

  insert into public.exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
    total_debit, total_credit, empreinte_precedente, empreinte, declaration)
  values (p_dossier_id, p_annee, v_maintenant, auth.uid(), v_mode, v_lignes, v_ecritures, v_debit, v_credit,
    v_precedente, v_empreinte, case when v_mode = 'tresorerie' then p_declaration end);

  return jsonb_build_object('annee', p_annee, 'lignes', v_lignes, 'ecritures', v_ecritures, 'a_nouveaux', v_an_attendus,
    'empreinte', v_empreinte, 'valide_le', v_maintenant);
end;
$$;

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
    -- Une écriture qui quitterait son dossier pendant sa validation y laisserait un trou dans la numérotation.
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
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
    raise exception '% : aucune écriture ne s''y passe plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.date)::integer) using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Les déclencheurs des sources jugent l'ancienne ligne d'une modification sur la frontière de son dossier, puis la
-- nouvelle comme une insertion, sur la frontière du sien.
create or replace function public.garder_mouvement_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    if v_frontiere is not null and old.date <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception '% : ce mouvement ne se supprime plus.',
          public.exercice_fige(old.dossier_id, extract(year from old.date)::integer) using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception '% : ce mouvement ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from old.date)::integer) using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.date <= v_frontiere then
    if tg_op = 'UPDATE' then
      raise exception '% : un mouvement ne s''y déplace plus.',
        public.exercice_fige(new.dossier_id, extract(year from new.date)::integer) using errcode = '23514';
    end if;
    -- La connexion bancaire réimporte une période en laissant la base écarter ce qu'elle connaît : le déclencheur
    -- passe avant cet écart.
    if not (new.id_externe is not null and exists (
         select 1 from public.lignes_bancaires where dossier_id = new.dossier_id and id_externe = new.id_externe)) then
      raise exception '% : un mouvement de cet exercice ne s''importe plus.',
        public.exercice_fige(new.dossier_id, extract(year from new.date)::integer) using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.garder_parts_mouvement_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_date date;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    select l.date into v_date from public.lignes_bancaires l where l.id = old.ligne_bancaire_id;
    if v_frontiere is not null and v_date <= v_frontiere then
      raise exception '% : la répartition de ce mouvement ne change plus.',
        public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  select l.date into v_date from public.lignes_bancaires l where l.id = new.ligne_bancaire_id;
  if v_frontiere is not null and v_date <= v_frontiere then
    raise exception '% : la répartition de ce mouvement ne change plus.',
      public.exercice_fige(new.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
  end if;
  return new;
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
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    select min(extract(year from e.date))::integer into v_annee
      from public.ecritures_brouillon e
     where e.statut = 'validee'
       and (e.immobilisation_id = old.id or (old.piece_id is not null and e.piece_id = old.piece_id));
    if v_annee is not null then
      if tg_op = 'DELETE' then
        raise exception 'Ce bien porte une écriture validée de l''exercice % : il ne se retire plus du registre.', v_annee
          using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception 'Ce bien porte une écriture validée de l''exercice % : sa valeur, ses dates et sa durée ne changent plus.',
          v_annee using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  -- Une modification n'est jugée que sur ce qu'elle change : un bien ancien sans écriture validée garde son libellé.
  if tg_op = 'INSERT' or (new.dossier_id, new.date_acquisition) is distinct from (old.dossier_id, old.date_acquisition) then
    v_frontiere := public.frontiere_validation(new.dossier_id);
    if v_frontiere is not null and new.date_acquisition <= v_frontiere then
      if tg_op = 'UPDATE' then
        raise exception '% : la date d''acquisition d''un bien ne s''y porte plus.',
          public.exercice_fige(new.dossier_id, extract(year from new.date_acquisition)::integer) using errcode = '23514';
      end if;
      raise exception '% : un bien acquis dans cet exercice ne s''inscrit plus au registre.',
        public.exercice_fige(new.dossier_id, extract(year from new.date_acquisition)::integer) using errcode = '23514';
    end if;
  end if;
  if new.piece_id is not null and (tg_op = 'INSERT' or new.piece_id is distinct from old.piece_id) and exists (
    select 1 from public.ecritures_brouillon where piece_id = new.piece_id and statut = 'validee'
  ) then
    raise exception 'Cette pièce porte une écriture validée : elle ne devient plus une immobilisation.' using errcode = '23514';
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
  v_derniere integer;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_derniere := extract(year from public.frontiere_validation(old.dossier_id))::integer;
    if old.annee <= v_derniere then
      if tg_op = 'DELETE'
         or (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
        raise exception '% : son cadre 7 ne change plus.', public.exercice_fige(old.dossier_id, old.annee)
          using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_derniere := extract(year from public.frontiere_validation(new.dossier_id))::integer;
  if new.annee <= v_derniere then
    raise exception '% : son cadre 7 ne change plus.', public.exercice_fige(new.dossier_id, new.annee)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Une échéance compte à la date du mouvement qui la paie, sinon à son échéance (lib/cotisationRapprochee.ts) : c'est
-- cette date qui dit si elle appartient à un exercice validé.
create or replace function public.garder_cotisation_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_date date;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    v_date := coalesce((select l.date from public.lignes_bancaires l where l.cotisation_id = old.id), old.echeance);
    if v_frontiere is not null and v_date <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception '% : cette échéance ne se supprime plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception '% : cette échéance ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.echeance <= v_frontiere
     and not exists (select 1 from public.lignes_bancaires l where l.cotisation_id = new.id) then
    raise exception '% : une échéance ne s''y ajoute plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.echeance)::integer) using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.garder_a_nouveaux_valides() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    if public.frontiere_validation(old.dossier_id) is not null then
      raise exception 'Un exercice de ce dossier est validé : son ouverture ne change plus.' using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  if public.frontiere_validation(new.dossier_id) is not null then
    raise exception 'Un exercice de ce dossier est validé : son ouverture ne change plus.' using errcode = '23514';
  end if;
  return new;
end;
$$;
