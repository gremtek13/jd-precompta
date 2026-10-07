-- Ligne 34 de la feuille de route : LE REPORT DES SOLDES D'UN EXERCICE SUR L'AUTRE. Jusqu'ici seule une balance reprise
-- d'un autre logiciel ouvrait un exercice (`a_nouveaux`) : l'exercice qui suit un exercice validé dans l'application
-- n'avait pas d'ouverture, son FEC commençait sans à-nouveaux, et chaque compte de bilan y paraissait sortir de nulle
-- part.
--
-- Décisions du cabinet le 06/10/2026 : les à-nouveaux de l'exercice suivant s'écrivent à la validation d'un exercice,
-- DANS LE MÊME CLIC, et reprennent exactement ses soldes figés ; tant qu'un exercice n'est pas validé, le suivant n'a
-- pas d'ouverture, et l'écran le dit. Pour une entreprise individuelle, le compte de l'exploitant (108) et le résultat
-- passent au capital individuel (101), comme le prévoit le plan comptable (art. 941-10) : le nouvel exercice repart
-- d'un 108 vide. Une société garde son résultat en 120 (bénéfice) ou 129 (perte), EN ATTENTE D'AFFECTATION, comme la
-- reprise d'une balance le fait déjà (src/lib/aNouveaux.ts) : l'application ne décide pas de son affectation.
--
-- UNE TABLE À PART, ET NON `a_nouveaux`. Celle-ci reste ce qu'elle est : l'ouverture d'un dossier REPRIS, une seule date
-- par dossier, et beaucoup de règles lisent sa date comme celle de la reprise — l'exercice qui se valide d'abord, un bien
-- acquis avant la reprise, une dotation ou un forfait que la balance reprise porte déjà, un mouvement ignoré antérieur à
-- la reprise. Les soldes reportés ne sont pas une reprise : ils ouvrent chaque exercice qui suit un exercice validé.
-- Une ouverture reprise et des soldes reportés ne couvrent jamais le même exercice : l'exercice repris se valide le
-- premier, et des à-nouveaux ne se posent plus dès qu'un exercice est validé.
--
-- CE QUI EST REPORTÉ : le solde de chaque compte à la fin de l'exercice validé — ses écritures validées et son ouverture,
-- reprise ou reportée —, en centimes exacts. Les classes 6 et 7 font le résultat ; pour une entreprise individuelle, le
-- 108, le 101 et le 12 passent au 101000 « Capital individuel » ; tout autre compte se reporte sous son numéro, avec le
-- libellé que l'exercice validé lui a figé. Un compte hors des classes 1 à 7 qui porte un solde fait refuser la
-- validation — il ne se reporte pas —, et une ouverture déséquilibrée aussi. Chaque ligne porte l'empreinte de
-- l'exercice dont elle vient : le maillon entre la fin d'un exercice et le début du suivant.
--
-- FIGÉS DÈS LEUR ÉCRITURE : ils ne s'écrivent qu'à la validation (déclencheur `garder_soldes_reportes`), ne changent plus
-- — sauf, une fois, les libellés que leur FEC lit, posés par la validation de l'exercice qu'ils ouvrent —, et ne partent
-- qu'avec leur dossier. La restauration d'une sauvegarde, par le super-administrateur, les réinsère avant tout exercice
-- validé, comme les écritures validées. L'empreinte de l'exercice qu'ils ouvrent les couvre, comme ses à-nouveaux.

create table public.soldes_reportes (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  -- Le 1er janvier de l'exercice qu'ils ouvrent, les exercices étant civils.
  date date not null,
  compte text not null check (compte ~ '^[1-5][0-9]{2,}$'),
  libelle text not null,
  sens text not null check (sens in ('debit', 'credit')),
  montant numeric(14,2) not null check (montant > 0),
  source_nom text not null,
  source_empreinte text not null check (source_empreinte ~ '^[0-9a-f]{64}$'),
  compte_lib text,
  ecriture_lib text,
  created_at timestamptz not null default now(),
  constraint soldes_reportes_ouverture check (extract(month from date) = 1 and extract(day from date) = 1),
  constraint soldes_reportes_libelles check (btrim(libelle) <> '' and btrim(source_nom) <> ''),
  constraint soldes_reportes_validation_complete check (
    (compte_lib is null) = (ecriture_lib is null)
    and (compte_lib is null or (btrim(compte_lib) <> '' and btrim(ecriture_lib) <> ''))
  ),
  constraint soldes_reportes_un_par_compte unique (dossier_id, date, compte)
);

comment on table public.soldes_reportes is
  'Soldes d''ouverture d''un exercice qui suit un exercice validé (ligne 34 de la feuille de route, décision du cabinet '
  'du 06/10/2026) : les soldes de fin de l''exercice validé, écrits par valider_exercice dans le même clic. Classes 1 '
  'à 5 ; pour une entreprise individuelle le 108, le 101 et le résultat passent au 101000 (capital individuel), pour '
  'une société le résultat est en 120 ou 129, en attente d''affectation. Figés dès leur écriture (déclencheur '
  'soldes_reportes_ecrits_par_la_validation).';

alter table public.soldes_reportes enable row level security;
-- Lus par le cabinet ; écrits par `valider_exercice` seule, qui contourne la RLS. La restauration d'une sauvegarde, par
-- le super-administrateur, les réinsère. Aucune modification, aucune suppression, pour personne : le déclencheur le
-- refuserait de toute façon.
create policy soldes_reportes_lecture on public.soldes_reportes
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy soldes_reportes_restauration on public.soldes_reportes
  for insert to authenticated with check (is_super_admin());

-- Les soldes reportés ne s'écrivent qu'à la validation (ou par la restauration d'une sauvegarde, dans un dossier qui ne
-- porte encore aucun exercice validé), ne changent plus — sauf, une fois, les libellés que la validation de l'exercice
-- qu'ils ouvrent leur pose —, et ne partent qu'avec leur dossier. DEFINER pour lire les exercices validés et le dossier
-- quelle que soit la RLS de l'appelant ; il ne rend rien.
create function public.garder_soldes_reportes() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Les soldes reportés d''un exercice validé ne se suppriment pas.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('jd.validation_exercice', true), '') = old.dossier_id::text
       and old.compte_lib is null
       and (to_jsonb(new) - 'compte_lib' - 'ecriture_lib') = (to_jsonb(old) - 'compte_lib' - 'ecriture_lib') then
      return new;
    end if;
    raise exception 'Les soldes reportés d''un exercice validé ne changent plus.' using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.validation_exercice', true), '') = new.dossier_id::text then
    return new;
  end if;
  if public.is_super_admin() and not exists (select 1 from public.exercices_valides where dossier_id = new.dossier_id) then
    return new;
  end if;
  raise exception 'Les soldes reportés ne s''écrivent qu''à la validation d''un exercice.' using errcode = '42501';
end;
$$;

create trigger soldes_reportes_ecrits_par_la_validation
  before insert or update or delete on public.soldes_reportes
  for each row execute function public.garder_soldes_reportes();

-- LES SOLDES DE FIN D'UN EXERCICE, tels qu'ils ouvrent le suivant : écritures validées, à-nouveaux repris et soldes
-- reportés de l'exercice, en centimes exacts, un compte par ligne. Appelée par `valider_exercice` une fois l'exercice
-- validé et ses libellés posés : chaque compte de l'exercice y a un libellé, et un seul. Le même calcul que
-- `soldesAReporter` (src/lib/reportDesSoldes.ts), qui montre l'ouverture avant le clic.
--   - Les classes 6 et 7 font le résultat : au 101000 pour une entreprise individuelle (trésorerie, ou engagement dont
--     le compte du dirigeant est le 108), sinon au 120000 (bénéfice) ou au 129000 (perte).
--   - Pour une entreprise individuelle, le 101, le 108 et le 12 passent au 101000 : le compte de l'exploitant est viré
--     au capital individuel en fin d'exercice, et le résultat aussi.
--   - Tout autre compte se reporte sous son numéro, avec le libellé que l'exercice lui a figé. Le 101000 sans libellé
--     dans l'exercice s'appelle « Capital individuel » ; le résultat d'une société porte son exercice, et, quand il
--     s'ajoute à un résultat antérieur encore en attente d'affectation, il le dit.
-- Un compte hors des classes 1 à 7 se rend tel quel : `valider_exercice` le refuse.
create function public.soldes_a_reporter(p_dossier_id uuid, p_annee integer)
returns table (compte text, libelle text, sens text, montant numeric)
language sql stable set search_path = public as $$
  with modele as (
    select (d.mode_comptable = 'tresorerie' or d.compte_notes_de_frais = '108000') as individuel
      from public.dossiers d where d.id = p_dossier_id
  ), mouvements as (
    select e.compte, e.compte_lib as lib, case when e.sens = 'debit' then e.montant else -e.montant end as net
      from public.ecritures_brouillon e
     where e.dossier_id = p_dossier_id and e.statut = 'validee'
       and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
    union all
    select a.compte, a.compte_lib, case when a.sens = 'debit' then a.montant else -a.montant end
      from public.a_nouveaux a
     where a.dossier_id = p_dossier_id and a.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
    union all
    select s.compte, s.compte_lib, case when s.sens = 'debit' then s.montant else -s.montant end
      from public.soldes_reportes s
     where s.dossier_id = p_dossier_id and s.date = make_date(p_annee, 1, 1)
  ), soldes as (
    select m.compte, max(m.lib) as lib, sum(m.net) as net from mouvements m group by m.compte
  ), resultat as (
    select coalesce(sum(s.net) filter (where s.compte ~ '^[67]'), 0) as net from soldes s
  ), cibles as (
    select s.compte, s.lib, s.net, md.individuel, r.net as resultat,
      case
        when s.compte ~ '^[67]' then
          case when md.individuel then '101000' when r.net < 0 then '120000' else '129000' end
        when md.individuel and s.compte ~ '^(101|108|12)' then '101000'
        else s.compte
      end as cible
    from soldes s cross join modele md cross join resultat r
  )
  select c.cible,
    case
      when not c.individuel and c.resultat <> 0 and c.cible = case when c.resultat < 0 then '120000' else '129000' end then
        case when bool_or(c.compte !~ '^[67]' and c.net <> 0) then 'Résultats en attente d’affectation'
          else format('Résultat de l’exercice %s (%s), en attente d’affectation', p_annee,
            case when c.resultat < 0 then 'bénéfice' else 'perte' end)
        end
      else coalesce(max(c.lib) filter (where c.compte = c.cible), case when c.cible = '101000' then 'Capital individuel' end)
    end,
    case when sum(c.net) > 0 then 'debit' else 'credit' end,
    abs(sum(c.net))
  from cibles c
  group by c.cible, c.individuel, c.resultat
  having sum(c.net) <> 0
$$;

-- L'empreinte couvre l'ouverture de l'exercice, reprise ou reportée, sous la même forme : un exercice ouvert par une
-- reprise garde exactement la chaîne qu'il avait.
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

-- VALIDER UN EXERCICE écrit désormais l'ouverture du suivant. Trois changements, le reste à l'identique : les libellés
-- proposés couvrent aussi les soldes reportés qui ouvrent l'exercice ; une fois l'exercice validé, ses soldes de fin
-- (`soldes_a_reporter`) sont contrôlés puis écrits, datés du 1er janvier suivant, avec l'empreinte de l'exercice ; et le
-- compte rendu dit combien.
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

revoke execute on function public.garder_soldes_reportes() from public, anon, authenticated;
revoke execute on function public.soldes_a_reporter(uuid, integer) from public, anon, authenticated;

comment on function public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb) is
  'Valide un exercice terminé : vérifie la numérotation proposée par l''application, fige ses écritures, enregistre l''exercice et écrit l''ouverture du suivant (soldes_reportes). Chef du cabinet seul.';
comment on function public.soldes_a_reporter(uuid, integer) is
  'Les soldes de fin d''un exercice, tels qu''ils ouvrent le suivant (ligne 34). Lue par valider_exercice seule.';
