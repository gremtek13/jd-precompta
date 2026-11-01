-- LE RETOUR ARRIÈRE DE `champs_bnc_du_fec` (les quatre champs du FEC d'un BNC en trésorerie, ligne 26.6, étape e ; lot
-- FEC22b). Le récit : HISTORIQUE.md, « LES QUATRE CHAMPS DU FEC D'UN BNC, EN BASE (FEC22B) ».
--
-- CE QU'IL FAIT, ET RIEN D'AUTRE : les trois fonctions que la migration reprend — `empreinte_exercice`, la garde G5
-- (`garder_lignes_de_la_vente_facturee`), `valider_exercice` et son commentaire — rendues telles que
-- `report_des_soldes`, `virement_mixte` et `validation_des_ventes_facturees` les ont laissées, au caractère près ; puis
-- la contrainte `ecritures_brouillon_champs_bnc_du_fec` et les cinq colonnes retirées. La base redevient celle d'avant
-- la migration, ses neuf familles comprises.
--
-- CE QU'IL DÉTRUIT : rien que la migration n'ait apporté — et rien qu'une validation ait figé : sa garde de tête le
-- refuse dès qu'une ligne du brouillon porte l'un des cinq champs (retirer leurs colonnes effacerait ce que l'exercice
-- a validé, et son empreinte ne se vérifierait plus). Un exercice validé sans eux garde son empreinte : l'empreinte
-- d'hier et celle de la migration rendent la même valeur sur une écriture qui ne les porte pas.
--
-- IL RETIRE DES COLONNES ET UNE CONTRAINTE (`drop`) : le détecteur d'`apply_migration` attendrait une confirmation ; il
-- se présente au cabinet, et se colle dans l'éditeur SQL de Supabase avec sa ligne d'historique (CLAUDE.md). La ligne
-- d'historique de la migration qu'il défait reste : il pose la sienne à la suite.
--
-- SA GARDE DE TÊTE : il se refuse si une des trois fonctions n'est plus celle que `champs_bnc_du_fec` a posée (une
-- autre migration l'a reprise depuis, ou ce texte a déjà été appliqué), ou si un champ est posé.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. Ce qu'il suppose : les trois fonctions de `champs_bnc_du_fec`, et aucun champ posé ══════════

do $$
declare
  v record;
  v_lignes bigint;
begin
  for v in select x.fonction, x.empreinte from (values
      ('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', '1827b6b7a6e10974b49499912757e535'),
      ('public.empreinte_exercice(uuid, integer, text)', 'd5221142acc9b109ecd24badfb1bf025'),
      ('public.garder_lignes_de_la_vente_facturee()', '52320c1e5903df610c1d592f59130c53')
    ) x(fonction, empreinte) loop
    -- Le corps que `champs_bnc_du_fec` a posé, au caractère près (les retours chariot d'un collage écartés) : une
    -- fonction changée depuis — par une autre migration, ou par une première application de ce retour — ne se rend pas
    -- sans être relue.
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then
      raise exception 'La fonction % en base n''est plus celle de la migration champs_bnc_du_fec : ce retour ne la rend pas sans être relu.',
        v.fonction;
    end if;
  end loop;
  -- Ce que ce retour retirerait : rien qu'une validation ait figé. Une seule ligne qui porte l'un des champs, et il se
  -- refuse — retirer ses colonnes détruirait ce que son exercice a validé, et son empreinte ne se vérifierait plus.
  select count(*) into v_lignes from public.ecritures_brouillon
   where num_nonnulls(date_reglement, mode_reglement, nature_operation, poste_rattache, identification_client) > 0;
  if v_lignes > 0 then
    raise exception 'Ce retour arrière détruirait les champs du FEC d''un BNC que % lignes validées portent : il ne s''applique pas.',
      v_lignes;
  end if;
end
$$;

-- ══ 1. Les trois fonctions d'hier, au caractère près ══════════
create or replace function public.empreinte_exercice(p_dossier_id uuid, p_annee integer, p_precedente text) returns text
language sql stable set search_path = public as $$
  select encode(sha256(convert_to(
    coalesce(p_precedente, '') || chr(29)
    || coalesce((
      select string_agg(concat_ws(chr(31),
          e.id::text, to_char(e.date, 'YYYY-MM-DD'), e.journal_code, e.numero_ecriture::text, e.compte, e.compte_lib,
          coalesce(e.comp_aux_num, ''), coalesce(e.comp_aux_lib, ''), e.piece_ref, to_char(e.piece_date, 'YYYY-MM-DD'),
          e.libelle, trim_scale(e.montant)::text, e.sens,
          to_char(e.valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')),
        chr(30) order by e.journal_code, e.numero_ecriture, e.id)
      from public.ecritures_brouillon e
      where e.dossier_id = p_dossier_id and e.statut = 'validee'
        and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)), '')
    || chr(29)
    || coalesce((
      select string_agg(concat_ws(chr(31),
          a.id::text, to_char(a.date, 'YYYY-MM-DD'), a.compte, coalesce(a.compte_origine, ''), a.libelle, a.sens,
          trim_scale(a.montant)::text, a.source_nom, a.source_empreinte, coalesce(a.compte_lib, ''),
          coalesce(a.ecriture_lib, '')),
        chr(30) order by a.compte, a.id)
      from (
        select n.id, n.date, n.compte, n.compte_origine, n.libelle, n.sens, n.montant, n.source_nom, n.source_empreinte,
               n.compte_lib, n.ecriture_lib
          from public.a_nouveaux n
         where n.dossier_id = p_dossier_id and n.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
        union all
        select s.id, s.date, s.compte, null::text, s.libelle, s.sens, s.montant, s.source_nom, s.source_empreinte,
               s.compte_lib, s.ecriture_lib
          from public.soldes_reportes s
         where s.dossier_id = p_dossier_id and s.date = make_date(p_annee, 1, 1)
      ) a), ''),
    'UTF8')), 'hex')
$$;

create or replace function public.garder_lignes_de_la_vente_facturee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reglage text := coalesce(current_setting('jd.ecriture_vente_facturee', true), '');
  v_avant text;
  v_apres text;
begin
  if tg_op <> 'INSERT' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return public.retour_declencheur(tg_op, old, new);
  end if;
  if tg_op <> 'DELETE' then
    v_apres := coalesce(new.encaissement_id, new.facture_id)::text;
    -- Une ligne qui porte une pièce n'est pas du troisième genre : c'est l'écriture de cette pièce — la banque de
    -- l'exemplaire d'une facture qui n'est pas source, que ce mouvement paie (le virement mixte, VF5h).
    if v_apres is null and new.piece_id is null and exists (select 1 from public.lignes_bancaires l
                                    where l.id = new.ligne_bancaire_id and l.encaissements_de_factures) then
      v_apres := new.ligne_bancaire_id::text;
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.encaissement_id is null and new.facture_id is null and v_apres is not null
       and not public.is_super_admin() and v_reglage is distinct from v_apres then
      raise exception 'Une écriture ne se passe sur un mouvement classé par ses encaissements que par la fonction qui écrit la vente facturée.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  v_avant := coalesce(old.encaissement_id, old.facture_id)::text;
  if v_avant is null and old.piece_id is null and exists (select 1 from public.lignes_bancaires l
                                  where l.id = old.ligne_bancaire_id and l.encaissements_de_factures) then
    v_avant := old.ligne_bancaire_id::text;
  end if;
  if tg_op = 'DELETE' then
    if v_avant is not null and v_reglage is distinct from v_avant then
      raise exception 'Une écriture de vente facturée ne se retire que par la fonction qui l''écrit.' using errcode = '42501';
    end if;
    return old;
  end if;
  if (to_jsonb(new) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref', 'piece_date', 'compte_lib',
                            'comp_aux_num', 'comp_aux_lib'])
     is not distinct from (to_jsonb(old) - array['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'piece_ref',
                                                'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib']) then
    return new;
  end if;
  if v_avant is not null and v_reglage is distinct from v_avant or v_apres is not null and v_reglage is distinct from v_apres then
    raise exception 'Une écriture de vente facturée ne se modifie que par la fonction qui l''écrit.' using errcode = '42501';
  end if;
  return new;
end
$$;

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
  v_hors text;
  v_ecart numeric;
  v_reportes integer;
  v_bascule boolean;
  v_mouvement record;
  v_numero text;
  v_encaissement record;
  v_vente record;
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
  -- LES VENTES FACTURÉES D'UN DOSSIER BASCULÉ (étape VF7b ; conception de VF7, § 3 c) : trois manques de G5 retiennent la
  -- validation, sous leur nom, avant la numérotation — un mouvement réservé, un virement ou un prélèvement sans son
  -- mouvement, une vente facturée qui n'est pas écrite à jour. Un dossier qui n'a pas basculé n'en porte aucun.
  v_bascule := coalesce((select d.ventes_par_les_factures from public.dossiers d where d.id = p_dossier_id), false);
  -- Un mouvement RÉSERVÉ (G2), daté jusqu'au 31 décembre : libre, et justifié par l'encaissement vivant d'une facture
  -- source. Il est à traiter : dit avant les mouvements à traiter, il l'est sous son nom, car il ne se classe que par ses
  -- encaissements — un débit, par ses contre-passations. La facture est celle que la garde des mouvements nomme.
  if v_bascule then
    select l.id, l.date, l.montant into v_mouvement
      from public.lignes_bancaires l
     where l.dossier_id = p_dossier_id and l.date <= v_fin and public.mouvement_libre(l)
       and exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = l.id and e.retire_le is null and f.source_de_la_vente
                      and public.encaissement_justifie_son_mouvement(e.id))
     order by l.date, l.id
     limit 1;
    if found then
      select f.numero into v_numero
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
       where e.ligne_bancaire_id = v_mouvement.id and e.retire_le is null and f.source_de_la_vente
         and public.encaissement_justifie_son_mouvement(e.id)
       order by e.cree_le, e.id
       limit 1;
      if v_mouvement.montant >= 0 then
        raise exception 'L''exercice % porte un mouvement du % réservé à l''encaissement de la facture % : le classer par ses encaissements avant la validation.',
          extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte un mouvement du % réservé à la contre-passation d''un encaissement de la facture % : le classer par ses contre-passations avant la validation.',
        extract(year from v_mouvement.date)::integer, to_char(v_mouvement.date, 'DD/MM/YYYY'), v_numero using errcode = '23514';
    end if;
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
  if v_bascule then
    -- Un encaissement vivant d'une facture source — ni retiré, ni contre-passation, ni défait par une contre-passation
    -- sans mouvement —, par virement ou par prélèvement, daté jusqu'au 31 décembre, qui ne cite aucun mouvement : encaissé
    -- à l'inscription au crédit, son mouvement est de son exercice ; il manque au relevé, ou n'y est pas rattaché. Un
    -- chèque, une carte ou un effet sans mouvement au 31 décembre est un en-cours (le 511, EC3-Q7) : il ne retient pas.
    select e.date_encaissement, e.moyen, f.numero into v_encaissement
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.annule_id is null
       and e.ligne_bancaire_id is null and e.moyen in ('virement', 'prelevement') and e.date_encaissement <= v_fin
       and public.encaissement_justifie_son_mouvement(e.id)
     order by e.date_encaissement, e.cree_le, e.id
     limit 1;
    if found then
      raise exception 'L''exercice % porte un encaissement de la facture % par % du %, sans son mouvement : il manque au relevé, ou n''y est pas rattaché — le rattacher avant la validation.',
        extract(year from v_encaissement.date_encaissement)::integer, v_encaissement.numero,
        case v_encaissement.moyen when 'virement' then 'virement' else 'prélèvement' end,
        to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    -- Une source dont ce qui s'écrit entre la frontière et le 31 décembre n'est pas EXACTEMENT ce que le brouillon
    -- propose, ou qui ne s'écrit pas quand sa date tombe dans cette période : la première, dans l'ordre de
    -- `ventes_facturees_de_l_exercice` — la période part de la frontière, et un premier exercice validé ne fige pas un
    -- manque d'avant lui.
    select v.* into v_vente from public.ventes_facturees_de_l_exercice(p_dossier_id, p_annee) v limit 1;
    if found then
      if v_vente.etat = 'a_ecrire' then
        raise exception 'L''exercice % porte une vente facturée qui n''est pas écrite : % — l''écrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_reecrire' then
        raise exception 'L''exercice % porte une vente facturée dont l''écriture proposée n''est plus celle que sa source commande : % — la réécrire avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      if v_vente.etat = 'a_retirer' then
        raise exception 'L''exercice % porte l''écriture proposée d''une vente facturée qui n''a plus rien à écrire : % — la retirer avant la validation.',
          extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
      end if;
      raise exception 'L''exercice % porte une vente facturée qui ne s''écrit pas : % — lever ce qui la retient avant la validation.',
        extract(year from v_vente.jour)::integer, v_vente.nom using errcode = '23514';
    end if;
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
      count(distinct piece_ref) as refs, count(distinct piece_date) as dates, count(distinct date) as jours
    from j group by journal, numero
  ), journaux as (
    select journal, min(numero) as premier, max(numero) as dernier, count(*) as nb from groupes group by journal
  ), an_l as (
    select * from jsonb_to_recordset(p_a_nouveaux) as x(id uuid, compte_lib text, ecriture_lib text)
  ), an_e as (
    -- L'ouverture de l'exercice : la balance reprise, ou les soldes reportés de l'exercice validé qui le précède.
    select id, compte from public.a_nouveaux where dossier_id = p_dossier_id and date between v_debut and v_fin
    union all
    select id, compte from public.soldes_reportes where dossier_id = p_dossier_id and date = v_debut
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
      when exists (select 1 from groupes where jours <> 1)
        then 'Les lignes d''une même écriture ne portent pas la même date.'
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

  -- Les déclencheurs d'intangibilité ne laissent passer « validée » — et les libellés des soldes reportés — qu'à cette
  -- fonction, pour ce dossier.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  update public.ecritures_brouillon e
     set statut = 'validee', valide_le = v_maintenant, journal_code = l.journal, numero_ecriture = l.numero,
         piece_ref = l.piece_ref, piece_date = l.piece_date, compte_lib = l.compte_lib,
         comp_aux_num = l.comp_aux_num, comp_aux_lib = l.comp_aux_lib
    from jsonb_to_recordset(p_lignes) as l(id uuid, journal text, numero integer, piece_ref text, piece_date date,
      compte_lib text, comp_aux_num text, comp_aux_lib text)
   where e.id = l.id and e.dossier_id = p_dossier_id;
  update public.soldes_reportes s set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where s.id = l.id and s.dossier_id = p_dossier_id;
  perform set_config('jd.validation_exercice', '', true);
  update public.a_nouveaux a set compte_lib = l.compte_lib, ecriture_lib = l.ecriture_lib
    from jsonb_to_recordset(p_a_nouveaux) as l(id uuid, compte_lib text, ecriture_lib text)
   where a.id = l.id and a.dossier_id = p_dossier_id;

  if exists (select 1 from public.ecritures_brouillon where dossier_id = p_dossier_id and date <= v_fin and statut = 'proposee') then
    raise exception 'Une écriture de l''exercice % n''a pas été validée.', p_annee using errcode = '23514';
  end if;

  -- Les soldes de fin de l'exercice, qui ouvriront le suivant : aucun compte hors des classes 1 à 7 ne doit porter de
  -- solde — il ne se reporterait pas —, et ils s'équilibrent, à-nouveaux compris.
  select string_agg(compte, ', ' order by compte) filter (where compte !~ '^[1-5][0-9]{2,}$'),
         coalesce(sum(case when sens = 'debit' then montant else -montant end), 0)
    into v_hors, v_ecart
    from public.soldes_a_reporter(p_dossier_id, p_annee);
  if v_hors is not null then
    raise exception 'L''exercice % se clôt sur le solde de comptes qui ne sont ni de bilan ni de résultat (%) : il ne se reporte pas, corriger leurs écritures avant la validation.',
      p_annee, v_hors using errcode = '23514';
  end if;
  if v_ecart <> 0 then
    raise exception 'Les soldes de l''exercice % ne s''équilibrent pas, à-nouveaux compris : l''ouverture de l''exercice suivant ne peut pas s''écrire.',
      p_annee using errcode = '23514';
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

  -- L'ouverture de l'exercice suivant, dans le même clic : ses soldes de fin, datés du 1er janvier suivant, chacun
  -- portant l'empreinte de l'exercice dont il vient.
  perform set_config('jd.validation_exercice', p_dossier_id::text, true);
  insert into public.soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  select p_dossier_id, make_date(p_annee + 1, 1, 1), r.compte, r.libelle, r.sens, r.montant,
         format('Exercice %s validé', p_annee), v_empreinte
    from public.soldes_a_reporter(p_dossier_id, p_annee) r;
  get diagnostics v_reportes = row_count;
  perform set_config('jd.validation_exercice', '', true);

  return jsonb_build_object('annee', p_annee, 'lignes', v_lignes, 'ecritures', v_ecritures, 'a_nouveaux', v_an_attendus,
    'reportes', v_reportes, 'empreinte', v_empreinte, 'valide_le', v_maintenant);
end;
$$;

comment on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) is
  'Valide un exercice terminé : vérifie la numérotation proposée par l''application, fige ses écritures, enregistre l''exercice et écrit l''ouverture du suivant (soldes_reportes) ; pour un dossier basculé, refuse aussi un mouvement réservé à des encaissements de factures, un virement ou un prélèvement sans son mouvement, et une vente facturée qui n''est pas écrite à jour. Chef du cabinet seul.';

-- ══ 2. La contrainte et les cinq colonnes, vides, retirées ══════════
alter table public.ecritures_brouillon
  drop constraint ecritures_brouillon_champs_bnc_du_fec,
  drop column date_reglement,
  drop column mode_reglement,
  drop column nature_operation,
  drop column poste_rattache,
  drop column identification_client;
