-- Ligne 26.8 de la feuille de route : LA TVA SE LIQUIDE, SON PAIEMENT ET SON REMBOURSEMENT S'ÉCRIVENT. Le brouillon
-- d'un dossier assujetti porte la TVA collectée (445710) et déductible (445660, 445620) de chaque pièce, et rien ne
-- la soldait : le prélèvement de la TVA par le Trésor ne s'écrivait sur aucun compte, si bien qu'il ne pouvait
-- qu'être ignoré, et manquait au FEC. Décision du cabinet du 06/10/2026 : à l'enregistrement d'une déclaration, une
-- écriture solde la TVA de la période sur le 445510 (TVA à décaisser), ou sur le 44567 pour un crédit, les arrondis à
-- l'euro de la CA3 allant en 658 ou 758 ; le prélèvement, rapproché de sa déclaration, solde le 445510 face à la
-- banque ; et le remboursement d'un crédit de TVA par le Trésor s'écrit aussi (44583).
--
-- LA DÉCLARATION PORTE CE QUE SA LIQUIDATION SOLDE : la CA3 telle qu'elle est enregistrée (`cases`, en euros), le
-- remboursement demandé (ligne 26), et les montants EXACTS de TVA, au centime, que la liquidation retire des comptes
-- 445710, 445660 et 445620 — ceux que le brouillon porte pour les pièces que la CA3 compte (lib/declarationTva.ts).
-- L'arrondi à l'euro de chaque ligne de la CA3 fait la différence entre ces centimes et ce qui se paie : il va au
-- 658000 (charge) ou au 758000 (produit), jamais au-delà de dix euros — au-delà, ce n'est pas un arrondi.
--
-- Une déclaration SAISIE À LA MAIN (`cases` nulle) n'existe que pour une période antérieure à l'ouverture d'un
-- dossier repris : sa TVA est dans les à-nouveaux (445510, 445670), et elle ne sert qu'à rattacher son paiement ou son
-- remboursement, et à reporter son crédit. Toute autre déclaration s'enregistre telle que l'application l'a préparée.
--
-- L'ÉCRITURE DE LIQUIDATION désigne sa déclaration (`ecritures_brouillon.declaration_tva_id`), ne porte ni pièce, ni
-- mouvement, ni bien, ni véhicule, et tombe au dernier jour de la période : le FEC la porte au journal des opérations
-- diverses. Le PAIEMENT et le REMBOURSEMENT désignent la leur sur le mouvement (`lignes_bancaires.declaration_tva_id`) :
-- un lien de plus dans `lignes_bancaires_un_seul_rapprochement`, sur un mouvement rapproché et jamais personnel.
-- Les deux clés sont sans action à la suppression : une déclaration ne se retire que par `retirer_declaration_tva`,
-- qui remet ses mouvements à traiter et retire ses écritures.

-- ── La déclaration ──

alter table public.declarations_tva
  add column remboursement_demande numeric not null default 0,
  add column cases jsonb,
  add column tva_collectee numeric,
  add column tva_deductible numeric,
  add column tva_deductible_immobilisations numeric;

comment on column public.declarations_tva.remboursement_demande is
  'Le remboursement de crédit demandé sur la déclaration (ligne 26 de la CA3, formulaire 3519), en euros. Il ne se '
  'reporte pas sur la déclaration suivante : la liquidation le porte au 445830, que le virement du Trésor solde.';
comment on column public.declarations_tva.cases is
  'La CA3 telle qu''elle a été enregistrée, case par case, en euros (lib/declarationTva.ts, CasesCa3). Nulle pour une '
  'déclaration saisie à la main, antérieure à l''ouverture du dossier, dont la TVA est dans les à-nouveaux.';
comment on column public.declarations_tva.tva_collectee is
  'La TVA collectée nette que la liquidation retire du 445710, au centime : celle que le brouillon porte pour les '
  'recettes que la CA3 compte. Nulle ssi cases l''est.';
comment on column public.declarations_tva.tva_deductible is
  'La TVA déductible nette que la liquidation retire du 445660, au centime. Nulle ssi cases l''est.';
comment on column public.declarations_tva.tva_deductible_immobilisations is
  'La TVA déductible sur immobilisations que la liquidation retire du 445620, au centime. Nulle ssi cases l''est.';

alter table public.declarations_tva
  add constraint declarations_tva_remboursement_check check (remboursement_demande >= 0),
  add constraint declarations_tva_liquidation_complete check (
    (cases is null and tva_collectee is null and tva_deductible is null and tva_deductible_immobilisations is null)
    or (jsonb_typeof(cases) = 'object'
        and tva_collectee is not null and tva_deductible is not null and tva_deductible_immobilisations is not null
        and tva_collectee = round(tva_collectee, 2) and tva_deductible = round(tva_deductible, 2)
        and tva_deductible_immobilisations = round(tva_deductible_immobilisations, 2))),
  -- Du premier jour d'un mois au dernier jour d'un mois, dans une seule année : un mois, un trimestre, ou une année
  -- pour une déclaration annuelle saisie à la main.
  add constraint declarations_tva_periode check (
    periode_debut <= periode_fin
    and extract(day from periode_debut) = 1
    and extract(day from periode_fin + 1) = 1
    and extract(year from periode_debut) = extract(year from periode_fin));

-- ── Les liens ──

alter table public.ecritures_brouillon add column declaration_tva_id uuid references public.declarations_tva(id);

comment on column public.ecritures_brouillon.declaration_tva_id is
  'La déclaration de TVA dont cette ligne est la liquidation (ligne 26.8) : sans pièce, ni mouvement, ni bien, ni '
  'véhicule, au dernier jour de la période. Posée par ecrire_liquidation_tva, retirée par retirer_declaration_tva.';

alter table public.ecritures_brouillon add constraint ecritures_brouillon_liquidation_sans_autre_source check (
  declaration_tva_id is null
  or (piece_id is null and ligne_bancaire_id is null and immobilisation_id is null and vehicule_id is null));

create index ecritures_brouillon_declaration_tva_id_idx on public.ecritures_brouillon (declaration_tva_id);

alter table public.lignes_bancaires add column declaration_tva_id uuid references public.declarations_tva(id);

comment on column public.lignes_bancaires.declaration_tva_id is
  'La déclaration de TVA que ce mouvement paie (une sortie, au 445510) ou dont il est le remboursement du crédit (une '
  'entrée, au 445830) — ligne 26.8. Posée avec son écriture par rapprocher_declaration_tva, retirée avec elle par '
  'retirer_rapprochement_declaration_tva. Exclusive de tout autre lien (lignes_bancaires_un_seul_rapprochement).';

alter table public.lignes_bancaires add constraint lignes_bancaires_declaration_tva_rapprochee
  check (declaration_tva_id is null or (statut = 'rapprochee' and not prelevement_personnel));

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id,
                      nullif(ventilee, false), nullif(reglement_groupe, false)) <= 1);

create index lignes_bancaires_declaration_tva_id_idx on public.lignes_bancaires (declaration_tva_id);

-- ── Une déclaration par période, et figée avec son exercice ──

-- Jamais deux déclarations qui se chevauchent : un mois déclaré deux fois — un mois et le trimestre qui le contient —
-- aurait sa TVA liquidée deux fois. Le verrou consultatif des déclarations d'un dossier sérialise deux enregistrements
-- concurrents, qui verraient sinon chacun l'absence de l'autre ; sa clé est écrite telle quelle ici et dans
-- `enregistrer_declaration_tva` — une fonction qui la calculerait devrait s'ouvrir aux comptes connectés, cette
-- fonction-là n'étant pas SECURITY DEFINER.
create function public.garder_declarations_sans_chevauchement() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('jd.declarations_tva:' || new.dossier_id::text, 0));
  if exists (
    select 1 from public.declarations_tva d
     where d.dossier_id = new.dossier_id and d.id <> new.id
       and d.periode_debut <= new.periode_fin and new.periode_debut <= d.periode_fin
  ) then
    raise exception 'Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci : retirez-la d''abord.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger declarations_tva_sans_chevauchement
  before insert or update on public.declarations_tva
  for each row execute function public.garder_declarations_sans_chevauchement();

-- Une déclaration dont la période tombe dans un exercice validé est figée avec lui : sa liquidation l'est, et c'est
-- d'elle que se déduisent la TVA à payer et le crédit reporté. Mêmes sorties que les autres sources : la cascade de la
-- suppression d'un dossier, qui ne voit plus le dossier, et la restauration d'une sauvegarde, faite avant tout
-- exercice validé.
create function public.garder_declaration_valide() returns trigger
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
    if v_frontiere is not null and old.periode_fin <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception '% : cette déclaration de TVA ne se retire plus.',
          public.exercice_fige(old.dossier_id, extract(year from old.periode_fin)::integer) using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception '% : cette déclaration de TVA ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from old.periode_fin)::integer) using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and new.periode_fin <= v_frontiere then
    raise exception '% : une déclaration de TVA ne s''y enregistre plus.',
      public.exercice_fige(new.dossier_id, extract(year from new.periode_fin)::integer) using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger declarations_tva_figees_par_la_validation
  before insert or update or delete on public.declarations_tva
  for each row execute function public.garder_declaration_valide();

-- ── La liquidation ──

-- L'écriture qu'une déclaration doit porter, composée depuis ce qu'elle a enregistré — la même que
-- `ecritureDeLaLiquidation` (lib/liquidationTva.ts). Chaque compte reçoit son SOLDE, positif au débit : la TVA
-- collectée au débit du 445710, la TVA déductible au crédit du 445660 et du 445620, le crédit de TVA au 445670 (le
-- crédit reporté sur la déclaration suivante, ligne 27, moins celui que la période a reçu, ligne 22), la TVA à payer
-- au crédit du 445510 (ligne 28), le remboursement demandé au débit du 445830 (ligne 26), et ce qui reste — l'arrondi à
-- l'euro des lignes de la CA3 — au débit du 658000 ou au crédit du 758000. Rien pour une déclaration saisie à la main,
-- ni pour un solde nul.
create function public.liquidation_attendue(p_declaration_id uuid)
returns table (compte text, sens text, montant numeric)
language sql
stable
set search_path = public
as $$
  with d as (
    select tva_collectee as collectee, tva_deductible as deductible,
           tva_deductible_immobilisations as immobilisations,
           coalesce((cases->>'l22')::numeric, 0) as l22, coalesce((cases->>'l26')::numeric, 0) as l26,
           coalesce((cases->>'l27')::numeric, 0) as l27, coalesce((cases->>'l28')::numeric, 0) as l28
      from public.declarations_tva
     where id = p_declaration_id and cases is not null
  ), soldes as (
    select '445710'::text as compte, collectee as solde from d
    union all select '445660', -deductible from d
    union all select '445620', -immobilisations from d
    union all select '445670', l27 - l22 from d
    union all select '445510', -l28 from d
    union all select '445830', l26 from d
  ), arrondi as (
    select -sum(solde) as solde from soldes
  ), toutes as (
    select s.compte, s.solde from soldes s
    union all select case when a.solde > 0 then '658000' else '758000' end, a.solde from arrondi a
  )
  select t.compte, case when t.solde > 0 then 'debit' else 'credit' end, abs(t.solde)
    from toutes t
   where t.solde <> 0
$$;

comment on function public.liquidation_attendue(uuid) is
  'L''écriture de liquidation qu''une déclaration de TVA doit porter, composée depuis ce qu''elle a enregistré (ligne '
  '26.8). Même composition que ecritureDeLaLiquidation (lib/liquidationTva.ts).';

-- (Ré)écrit la liquidation d'une déclaration. L'écriture est composée par l'application ; la base la VÉRIFIE contre
-- celle que la déclaration enregistrée commande, en multiensemble, puis remplace la précédente.
create function public.ecrire_liquidation_tva(p_declaration_id uuid, p_ecriture jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_declaration public.declarations_tva%rowtype;
  v_arrondi numeric;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_declaration from public.declarations_tva where id = p_declaration_id for update;
  if not found or not admin_du_dossier(v_declaration.dossier_id) then
    raise exception 'Accès refusé à cette déclaration.' using errcode = '42501';
  end if;
  if v_declaration.cases is null then
    raise exception 'Cette déclaration a été saisie à la main : sa TVA est dans les à-nouveaux, elle n''écrit pas de liquidation.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon where declaration_tva_id = p_declaration_id and statut <> 'proposee'
  ) then
    raise exception 'La liquidation de cette déclaration est validée : elle ne se réécrit plus.' using errcode = '23514';
  end if;
  select coalesce(max(montant), 0) into v_arrondi
    from public.liquidation_attendue(p_declaration_id) where compte in ('658000', '758000');
  if v_arrondi > 10 then
    raise exception 'La liquidation ne s''équilibre pas : un écart de % € entre la TVA des comptes et la TVA déclarée n''est pas un arrondi.',
      v_arrondi using errcode = '22023';
  end if;

  if jsonb_typeof(p_ecriture) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select compte, sens, montant from public.liquidation_attendue(p_declaration_id)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
      from jsonb_array_elements(p_ecriture) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à cette déclaration.' using errcode = '22023';
  end if;

  delete from public.ecritures_brouillon where declaration_tva_id = p_declaration_id;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, declaration_tva_id, date, compte,
                                          libelle, montant, sens, statut)
  select v_declaration.dossier_id, null, null, p_declaration_id, v_declaration.periode_fin, e->>'compte',
         coalesce(e->>'libelle', ''), (e->>'montant')::numeric, e->>'sens', 'proposee'
    from jsonb_array_elements(p_ecriture) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
    from public.ecritures_brouillon where declaration_tva_id = p_declaration_id;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;
  return v_nb;
end;
$$;

comment on function public.ecrire_liquidation_tva(uuid, jsonb) is
  'Écrit (ou réécrit) la liquidation d''une déclaration de TVA, vérifiée contre liquidation_attendue (ligne 26.8).';

-- Enregistre une déclaration ET sa liquidation, dans une transaction. Refait les refus de l'écran
-- (`refusEnregistrement`, lib/liquidationTva.ts) dans le même ordre, et vérifie que la CA3 proposée se tient : ses
-- lignes se déduisent les unes des autres comme la notice le dit, et ses montants exacts accompagnent ses cases.
create function public.enregistrer_declaration_tva(
  p_dossier_id uuid,
  p_periode_debut date,
  p_periode_fin date,
  p_tva_declaree numeric,
  p_credit_anterieur numeric,
  p_remboursement_demande numeric,
  p_date_declaration date,
  p_cases jsonb,
  p_tva_collectee numeric,
  p_tva_deductible numeric,
  p_tva_deductible_immobilisations numeric,
  p_ecriture jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_assujetti boolean;
  v_ouverture date;
  v_id uuid;
  v_aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  l16 numeric; l19 numeric; l20 numeric; l21 numeric; l22 numeric; l23 numeric;
  l25 numeric; l26 numeric; l27 numeric; l28 numeric; l32 numeric;
begin
  if p_dossier_id is null or not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.declarations_tva:' || p_dossier_id::text, 0));
  select assujetti_tva into v_assujetti from public.dossiers where id = p_dossier_id;
  if not coalesce(v_assujetti, false) then
    raise exception 'Ce dossier n''est pas assujetti à la TVA : il n''a pas de déclaration à enregistrer.'
      using errcode = '22023';
  end if;
  if p_periode_debut is null or p_periode_fin is null or p_periode_debut > p_periode_fin
     or extract(day from p_periode_debut) <> 1 or extract(day from p_periode_fin + 1) <> 1
     or extract(year from p_periode_debut) <> extract(year from p_periode_fin) then
    raise exception 'Une période de TVA va du premier jour d''un mois au dernier jour d''un mois, dans une même année.'
      using errcode = '22023';
  end if;
  if p_periode_fin >= v_aujourdhui then
    raise exception 'La période n''est pas terminée : sa déclaration s''enregistre une fois déposée.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.declarations_tva d
     where d.dossier_id = p_dossier_id and d.periode_debut <= p_periode_fin and p_periode_debut <= d.periode_fin
  ) then
    raise exception 'Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci : retirez-la d''abord.'
      using errcode = '23505';
  end if;
  if p_tva_declaree is null or p_credit_anterieur is null or p_credit_anterieur < 0 then
    raise exception 'La TVA nette de la période et le crédit reporté (ligne 22, positif ou nul) sont à renseigner.'
      using errcode = '22023';
  end if;
  if p_remboursement_demande is null or p_remboursement_demande < 0 then
    raise exception 'Le remboursement demandé (ligne 26) est un montant positif ou nul.' using errcode = '22023';
  end if;
  if p_remboursement_demande > greatest(p_credit_anterieur - p_tva_declaree, 0) then
    raise exception 'Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période (ligne 25).'
      using errcode = '22023';
  end if;

  select min(date) into v_ouverture from public.a_nouveaux where dossier_id = p_dossier_id;
  if p_cases is null then
    if v_ouverture is null or p_periode_fin >= v_ouverture then
      raise exception 'Une déclaration s''enregistre telle que l''application l''a préparée : seule une période antérieure à l''ouverture du dossier, dont la TVA est dans les à-nouveaux, se saisit à la main.'
        using errcode = '22023';
    end if;
    if p_tva_collectee is not null or p_tva_deductible is not null or p_tva_deductible_immobilisations is not null
       or coalesce(jsonb_array_length(case when jsonb_typeof(p_ecriture) = 'array' then p_ecriture end), 0) > 0 then
      raise exception 'Une déclaration saisie à la main n''écrit pas de liquidation : sa TVA est dans les à-nouveaux.'
        using errcode = '22023';
    end if;
  else
    if v_ouverture is not null and p_periode_fin < v_ouverture then
      raise exception 'Cette période précède l''ouverture du dossier : sa TVA est dans les à-nouveaux, et sa déclaration se saisit à la main, sans liquidation.'
        using errcode = '22023';
    end if;
    if jsonb_typeof(p_cases) is distinct from 'object' or exists (
      select 1 from unnest(array['l16', 'l19', 'l20', 'l21', 'l22', 'l23', 'l25', 'l26', 'l27', 'l28', 'l32']) as k
       where jsonb_typeof(p_cases->k) is distinct from 'number'
          or (p_cases->>k)::numeric < 0 or (p_cases->>k)::numeric <> trunc((p_cases->>k)::numeric)
    ) then
      raise exception 'La déclaration proposée est illisible : ses lignes sont des montants en euros entiers, positifs ou nuls.'
        using errcode = '22023';
    end if;
    l16 := (p_cases->>'l16')::numeric; l19 := (p_cases->>'l19')::numeric; l20 := (p_cases->>'l20')::numeric;
    l21 := (p_cases->>'l21')::numeric; l22 := (p_cases->>'l22')::numeric; l23 := (p_cases->>'l23')::numeric;
    l25 := (p_cases->>'l25')::numeric; l26 := (p_cases->>'l26')::numeric; l27 := (p_cases->>'l27')::numeric;
    l28 := (p_cases->>'l28')::numeric; l32 := (p_cases->>'l32')::numeric;
    if l22 <> p_credit_anterieur or l26 <> p_remboursement_demande or p_tva_declaree <> l16 - l19 - l20 - l21
       or l23 <> l19 + l20 + l21 + l22 or l25 <> greatest(l23 - l16, 0) or l28 <> greatest(l16 - l23, 0)
       or l32 <> l28 or l27 <> l25 - l26 then
      raise exception 'La déclaration proposée ne se tient pas : ses lignes ne se déduisent pas les unes des autres.'
        using errcode = '22023';
    end if;
    if p_tva_collectee is null or p_tva_deductible is null or p_tva_deductible_immobilisations is null then
      raise exception 'Les montants de TVA que la liquidation solde manquent.' using errcode = '22023';
    end if;
  end if;

  insert into public.declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree, credit_anterieur,
                                       remboursement_demande, date_declaration, cases, tva_collectee, tva_deductible,
                                       tva_deductible_immobilisations)
  values (p_dossier_id, p_periode_debut, p_periode_fin, p_tva_declaree, p_credit_anterieur, p_remboursement_demande,
          p_date_declaration, p_cases, p_tva_collectee, p_tva_deductible, p_tva_deductible_immobilisations)
  returning id into v_id;

  if p_cases is not null then
    perform public.ecrire_liquidation_tva(v_id, p_ecriture);
  end if;
  return v_id;
end;
$$;

comment on function public.enregistrer_declaration_tva(uuid, date, date, numeric, numeric, numeric, date, jsonb, numeric,
  numeric, numeric, jsonb) is
  'Enregistre une déclaration de TVA ET sa liquidation, dans une transaction (ligne 26.8). Refait les refus de '
  'refusEnregistrement (lib/liquidationTva.ts).';

-- Retire une déclaration : ses mouvements retournent à traiter, sans leur écriture, et sa liquidation part avec elle.
-- Rend le nombre de mouvements remis à traiter.
create function public.retirer_declaration_tva(p_declaration_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_declaration public.declarations_tva%rowtype;
  v_nb integer;
begin
  select * into v_declaration from public.declarations_tva where id = p_declaration_id for update;
  if not found or not admin_du_dossier(v_declaration.dossier_id) then
    raise exception 'Accès refusé à cette déclaration.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon e
     where e.statut <> 'proposee'
       and (e.declaration_tva_id = p_declaration_id
            or (e.piece_id is null and e.ligne_bancaire_id in (
                  select l.id from public.lignes_bancaires l where l.declaration_tva_id = p_declaration_id)))
  ) then
    raise exception 'Une écriture de cette déclaration — sa liquidation ou un paiement — est validée : elle ne se retire plus.'
      using errcode = '23514';
  end if;

  delete from public.ecritures_brouillon
   where piece_id is null
     and ligne_bancaire_id in (select l.id from public.lignes_bancaires l where l.declaration_tva_id = p_declaration_id);
  update public.lignes_bancaires
     set declaration_tva_id = null, statut = 'non_rapprochee'
   where declaration_tva_id = p_declaration_id;
  get diagnostics v_nb = row_count;
  delete from public.ecritures_brouillon where declaration_tva_id = p_declaration_id;
  delete from public.declarations_tva where id = p_declaration_id;
  return v_nb;
end;
$$;

comment on function public.retirer_declaration_tva(uuid) is
  'Retire une déclaration de TVA, sa liquidation, et remet à traiter les mouvements qui la paient (ligne 26.8).';

-- ── Le paiement et le remboursement ──

-- Rapproche un mouvement de la déclaration qu'il paie (une sortie) ou dont il rembourse le crédit (une entrée), ET
-- écrit son écriture : la banque face au 445510 (TVA à décaisser) ou au 445830 (remboursement demandé), au montant, à
-- la date et dans le sens du mouvement. Le montant est libre — un paiement en deux fois, une majoration —, et les
-- écrans disent une déclaration payée en partie ou en trop.
create function public.rapprocher_declaration_tva(p_ligne_bancaire_id uuid, p_declaration_id uuid, p_ecriture jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_declaration public.declarations_tva%rowtype;
  v_a_payer numeric;
  v_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  select * into v_declaration from public.declarations_tva where id = p_declaration_id;
  if not found or v_declaration.dossier_id <> v_ligne.dossier_id then
    raise exception 'Cette déclaration de TVA n''est pas celle de ce dossier.' using errcode = '22023';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.compte_bilan is not null then
    raise exception 'Ce mouvement est écrit sur le compte %, un compte de bilan : annule d''abord ce classement.',
      v_ligne.compte_bilan using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if v_ligne.date <= v_declaration.periode_fin then
    raise exception 'Un paiement de TVA suit la période qu''il règle : ce mouvement est du %, la période se termine le %.',
      to_char(v_ligne.date, 'DD/MM/YYYY'), to_char(v_declaration.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_a_payer := case when v_declaration.cases is null
    then greatest(v_declaration.tva_declaree - v_declaration.credit_anterieur, 0)
    else (v_declaration.cases->>'l32')::numeric end;
  if v_ligne.montant < 0 and coalesce(v_a_payer, 0) <= 0 then
    raise exception 'Cette déclaration n''a pas de TVA à payer.' using errcode = '22023';
  end if;
  if v_ligne.montant > 0 and v_declaration.remboursement_demande <= 0 then
    raise exception 'Aucun remboursement de crédit n''a été demandé sur cette déclaration (ligne 26).' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
     where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  v_compte := case when v_ligne.montant < 0 then '445510' else '445830' end;
  if jsonb_typeof(p_ecriture) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select '512000'::text as compte, case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select v_compte, case when v_ligne.montant > 0 then 'credit' else 'debit' end, abs(v_ligne.montant)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
      from jsonb_array_elements(p_ecriture) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette déclaration.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set declaration_tva_id = p_declaration_id, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
    from jsonb_array_elements(p_ecriture) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
    from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;
  return v_nb;
end;
$$;

comment on function public.rapprocher_declaration_tva(uuid, uuid, jsonb) is
  'Rapproche un mouvement de la déclaration de TVA qu''il paie ou rembourse ET écrit son écriture (445510 ou 445830 '
  'face à la banque), dans une transaction (ligne 26.8). Rejouée sur un mouvement déjà rapproché d''une déclaration, '
  'elle remplace le lien et l''écriture.';

create function public.retirer_rapprochement_declaration_tva(p_ligne_bancaire_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.declaration_tva_id is null then
    raise exception 'Ce mouvement ne paie aucune déclaration de TVA.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
     where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set declaration_tva_id = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_rapprochement_declaration_tva(uuid) is
  'Remet à traiter un mouvement rapproché d''une déclaration de TVA ET retire son écriture (ligne 26.8).';

revoke execute on function public.garder_declarations_sans_chevauchement() from public, anon, authenticated;
revoke execute on function public.garder_declaration_valide() from public, anon, authenticated;
revoke execute on function public.liquidation_attendue(uuid) from public, anon;
grant execute on function public.liquidation_attendue(uuid) to authenticated;
revoke execute on function public.ecrire_liquidation_tva(uuid, jsonb) from public, anon;
grant execute on function public.ecrire_liquidation_tva(uuid, jsonb) to authenticated;
revoke execute on function public.enregistrer_declaration_tva(uuid, date, date, numeric, numeric, numeric, date, jsonb,
  numeric, numeric, numeric, jsonb) from public, anon;
grant execute on function public.enregistrer_declaration_tva(uuid, date, date, numeric, numeric, numeric, date, jsonb,
  numeric, numeric, numeric, jsonb) to authenticated;
revoke execute on function public.retirer_declaration_tva(uuid) from public, anon;
grant execute on function public.retirer_declaration_tva(uuid) to authenticated;
revoke execute on function public.rapprocher_declaration_tva(uuid, uuid, jsonb) from public, anon;
grant execute on function public.rapprocher_declaration_tva(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_rapprochement_declaration_tva(uuid) from public, anon;
grant execute on function public.retirer_rapprochement_declaration_tva(uuid) to authenticated;
