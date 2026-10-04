-- Ligne 26.6 de la feuille de route, étape (d) : VALIDER UN EXERCICE. Une comptabilité informatisée n'est régulière
-- qu'après la procédure de validation qui fige ses écritures : « le caractère définitif des enregistrements du
-- livre-journal est assuré, pour les comptabilités tenues au moyen de systèmes informatisés, par une procédure de
-- validation, qui interdit toute modification ou suppression de l'enregistrement » (plan comptable général,
-- art. 1031-3, version du 1er janvier 2026) ; et « la réouverture d'un exercice clôturé à des fins de modification
-- ou de suppression des écritures comptables est interdite » (BOI-BIC-DECLA-30-10-20-40, § 130 à 140). Une erreur
-- trouvée après se corrige par une écriture sur l'exercice suivant, jamais en place.
--
-- Décisions du cabinet le 04/10/2026 : la validation se refuse tant que la 2035 et les écritures ne concordent pas
-- au centime (en engagement, tant qu'une écriture est en anomalie) — c'est l'application qui le vérifie, la base
-- ne sachant pas calculer une 2035 ; ce qui a produit les écritures validées est figé aussi (migration suivante) ;
-- valider ne clôture pas (la purge du texte lu et la fin des relances restent un geste à part) ; seul le chef du
-- cabinet valide.
--
-- CE QUE LA BASE FIGE. Une écriture validée porte son numéro définitif dans son journal, sa date de validation et
-- les champs du FEC qui se lisaient ailleurs — la référence et la date de sa pièce, le libellé de son compte, son
-- compte auxiliaire —, pour que le FEC d'un exercice validé se relise depuis elle seule : une catégorie renommée,
-- un tiers corrigé ou une évolution de l'application ne le changent plus. Les à-nouveaux de l'exercice qu'ils
-- ouvrent portent de même le libellé de leur compte et celui de leur écriture. Le refus de toute modification vit
-- dans un DÉCLENCHEUR et non dans une policy : deux chemins de l'application écrivent le brouillon sans passer par
-- une fonction (« Régénérer », et le rapprochement qui redate), et une policy ne protège pas d'un appel direct.
--
-- LA FRONTIÈRE : le 31 décembre du dernier exercice validé. Aucune écriture non validée ne s'y passe plus, et les
-- exercices se valident dans l'ordre — celui des à-nouveaux d'abord. Ce que la frontière fige ne doit rien laisser
-- en suspens : un mouvement bancaire encore à traiter le resterait pour toujours, il se traite donc avant. Une
-- opération découverte après coup se rattache, selon l'article 1031-4, au premier jour de la période non encore
-- clôturée, avec mention de sa date de survenance : l'application ne le modélise pas encore, elle la refuse et le
-- dit.
--
-- LA SEULE SORTIE D'UNE ÉCRITURE VALIDÉE est la suppression de son dossier entier, que le cabinet peut devoir
-- faire (fin de mission, effacement). Éprouvé sur une réplique locale : pendant la cascade d'un dossier, ses pièces
-- et ses écritures ne le voient déjà plus, alors qu'une suppression directe le voit. C'est ce critère qui laisse
-- passer la cascade, et lui seul.

alter table public.ecritures_brouillon
  add column valide_le timestamptz,
  add column journal_code text,
  add column numero_ecriture integer,
  add column piece_ref text,
  add column piece_date date,
  add column compte_lib text,
  add column comp_aux_num text,
  add column comp_aux_lib text,
  -- Une écriture proposée ne porte rien de la validation ; une écriture validée porte tout ce que son FEC lit.
  add constraint ecritures_brouillon_validation_complete check (
    (statut = 'proposee' and valide_le is null and journal_code is null and numero_ecriture is null
      and piece_ref is null and piece_date is null and compte_lib is null and comp_aux_num is null and comp_aux_lib is null)
    or (statut = 'validee' and valide_le is not null and journal_code in ('AC', 'VE', 'BQ', 'OD') and numero_ecriture >= 1
      and btrim(piece_ref) <> '' and piece_date is not null and btrim(compte_lib) <> ''
      and (comp_aux_num is null) = (comp_aux_lib is null)
      and (comp_aux_num is null or (btrim(comp_aux_num) <> '' and btrim(comp_aux_lib) <> '')))
  );

-- Les déclencheurs de la migration suivante demandent, pour chaque pièce modifiée, si elle porte une écriture
-- validée : l'index ne porte que celles-là.
create index ecritures_brouillon_piece_validee_idx on public.ecritures_brouillon (piece_id) where statut = 'validee';
-- La validation lit les écritures d'un dossier par date, et la frontière se juge sur elle : sans index, chaque
-- validation parcourrait le brouillon de tous les dossiers.
create index ecritures_brouillon_dossier_date_idx on public.ecritures_brouillon (dossier_id, date);

-- Les à-nouveaux d'un exercice validé portent ce que son FEC en lit — le libellé de leur compte et celui de leur
-- écriture —, comme ses écritures. Rien tant que l'exercice qu'ils ouvrent n'est pas validé.
alter table public.a_nouveaux
  add column compte_lib text,
  add column ecriture_lib text,
  add constraint a_nouveaux_validation_complete check (
    (compte_lib is null) = (ecriture_lib is null)
    and (compte_lib is null or (btrim(compte_lib) <> '' and btrim(ecriture_lib) <> ''))
  );

-- Un exercice validé : qui l'a validé et quand, ce qu'il contient, son empreinte, et la 2035 telle qu'elle a été
-- validée (trésorerie), pour qu'une évolution du calcul ne puisse plus la changer. L'empreinte est CHAÎNÉE à celle
-- de l'exercice validé précédent : modifier un exercice validé par un chemin qui contourne les déclencheurs se
-- voit à la vérification (`verifier_exercice_valide`).
create table public.exercices_valides (
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  annee integer not null,
  valide_le timestamptz not null,
  -- Repère d'audit, sans clé étrangère : retirer un compte ne doit pas effacer qui a validé.
  valide_par uuid not null,
  mode_comptable text not null,
  nb_lignes integer not null,
  nb_ecritures integer not null,
  total_debit numeric(16,2) not null,
  total_credit numeric(16,2) not null,
  empreinte_precedente text,
  empreinte text not null,
  declaration jsonb,
  constraint exercices_valides_pkey primary key (dossier_id, annee),
  constraint exercices_valides_annee check (annee between 2000 and 2100),
  constraint exercices_valides_mode check (mode_comptable in ('tresorerie', 'engagement')),
  constraint exercices_valides_comptes check (nb_lignes >= 0 and nb_ecritures >= 0 and nb_ecritures <= nb_lignes),
  constraint exercices_valides_equilibre check (total_debit = total_credit),
  constraint exercices_valides_empreintes check (
    empreinte ~ '^[0-9a-f]{64}$' and (empreinte_precedente is null or empreinte_precedente ~ '^[0-9a-f]{64}$')
  ),
  -- Un dossier tenu en trésorerie valide sa 2035 avec ses écritures ; un dossier en engagement n'en a pas.
  constraint exercices_valides_declaration check (
    (mode_comptable = 'tresorerie') = (declaration is not null)
    and (declaration is null or jsonb_typeof(declaration) = 'object')
  )
);

alter table public.exercices_valides enable row level security;
-- Lu par le cabinet ; écrit par `valider_exercice` seule, qui contourne la RLS et vérifie l'accès elle-même. La
-- restauration d'une sauvegarde, par le super-administrateur, réinsère les exercices validés.
create policy exercices_valides_lecture on public.exercices_valides
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy exercices_valides_restauration on public.exercices_valides
  for insert to authenticated with check (is_super_admin());

-- Le verrou consultatif d'un dossier : la validation le prend en EXCLUSIF, toute écriture au brouillon et toute
-- modification d'une source qu'elle fige le prennent en PARTAGÉ. Sans lui, une écriture insérée pendant la
-- validation resterait proposée dans un exercice validé, et une pièce modifiée pendant ce temps divergerait de son
-- écriture figée.
create function public.cle_validation(p_dossier_id uuid) returns bigint
language sql immutable set search_path = public as $$
  select hashtextextended('jd.validation_exercice:' || p_dossier_id::text, 0)
$$;

-- Le 31 décembre du dernier exercice validé du dossier, ou rien.
create function public.frontiere_validation(p_dossier_id uuid) returns date
language sql stable set search_path = public as $$
  select make_date(max(annee), 12, 31) from public.exercices_valides where dossier_id = p_dossier_id
$$;

-- L'empreinte SHA-256 d'un exercice validé : ses écritures validées dans l'ordre de leurs numéros, puis les
-- à-nouveaux qu'il ouvre, précédés de l'empreinte de l'exercice validé précédent. Chaque valeur est écrite sous une
-- forme qui ne dépend ni du réglage de session (fuseau, style de date) ni de l'échelle d'un nombre — une
-- sauvegarde restaurée réécrit 12.50 en 12.5, et l'empreinte doit survivre à une restauration.
create function public.empreinte_exercice(p_dossier_id uuid, p_annee integer, p_precedente text) returns text
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
      from public.a_nouveaux a
      where a.dossier_id = p_dossier_id and a.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)), ''),
    'UTF8')), 'hex')
$$;

-- L'exercice validé se relit-il encore tel qu'il a été validé, et son maillon tient-il à l'exercice validé
-- précédent ? Rien quand l'exercice n'est pas validé — ou pas lisible par l'appelant, la RLS s'appliquant ici.
create function public.verifier_exercice_valide(p_dossier_id uuid, p_annee integer) returns boolean
language sql stable set search_path = public as $$
  select v.empreinte = public.empreinte_exercice(v.dossier_id, v.annee, v.empreinte_precedente)
    and v.empreinte_precedente is not distinct from (
      select p.empreinte from public.exercices_valides p
      where p.dossier_id = v.dossier_id and p.annee < v.annee order by p.annee desc limit 1)
  from public.exercices_valides v
  where v.dossier_id = p_dossier_id and v.annee = p_annee
$$;

-- VALIDER UN EXERCICE. La numérotation est composée par l'application, avec la logique même de son FEC ; la base
-- vérifie ce qu'elle peut vérifier sans la refaire : qu'elle couvre exactement les écritures de l'exercice, que les
-- numéros de chaque journal se suivent depuis 1 dans l'ordre des dates, que chaque écriture est équilibrée au
-- centime et porte une seule pièce, et qu'un compte ne porte qu'un libellé — à-nouveaux compris, dont les libellés
-- arrivent à part (`p_a_nouveaux`). La concordance avec la 2035, elle, est vérifiée par l'application juste avant
-- l'appel : la base ne sait pas calculer une 2035.
create function public.valider_exercice(
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
    raise exception 'L''exercice % porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.',
      v_anterieur using errcode = '23514';
  end if;
  -- Un mouvement daté d'un exercice validé ne change plus (migration suivante) : encore à traiter, il le resterait.
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

-- L'INTANGIBILITÉ. Une écriture validée ne se modifie ni ne se supprime — sauf avec son dossier entier ; ne devient
-- « validée » que par `valider_exercice` (ou par la restauration d'une sauvegarde, par le super-administrateur) ;
-- et aucune écriture non validée ne se passe à une date que la validation a figée. DEFINER pour lire les
-- exercices validés et le dossier quelle que soit la RLS de l'appelant ; il ne rend rien.
create function public.garder_ecritures_validees() returns trigger
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
    if tg_op = 'INSERT' and public.is_super_admin() then
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

create trigger ecritures_brouillon_intangibles
  before insert or update or delete on public.ecritures_brouillon
  for each row execute function public.garder_ecritures_validees();

revoke execute on function public.cle_validation(uuid) from public, anon, authenticated;
revoke execute on function public.frontiere_validation(uuid) from public, anon, authenticated;
revoke execute on function public.garder_ecritures_validees() from public, anon, authenticated;
revoke execute on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) to authenticated;
revoke execute on function public.empreinte_exercice(uuid, integer, text) from public, anon;
grant execute on function public.empreinte_exercice(uuid, integer, text) to authenticated;
revoke execute on function public.verifier_exercice_valide(uuid, integer) from public, anon;
grant execute on function public.verifier_exercice_valide(uuid, integer) to authenticated;

comment on table public.exercices_valides is
  'Exercices validés : leurs écritures sont figées (déclencheur ecritures_brouillon_intangibles), avec leur empreinte chaînée et la 2035 validée.';
comment on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) is
  'Valide un exercice terminé : vérifie la numérotation proposée par l''application, fige ses écritures et enregistre l''exercice. Chef du cabinet seul.';
