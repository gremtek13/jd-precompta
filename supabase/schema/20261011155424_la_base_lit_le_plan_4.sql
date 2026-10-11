-- LA BASE LIT LE PLAN, SANS RIEN CHANGER — ligne 43, étape PC2, migration 4 sur 6 :
-- la TVA : son paiement, sa liquidation et l'écriture attendue.
-- Le pourquoi et la règle : l'en-tête de la_base_lit_le_plan_1. Collée par le cabinet : ses corps retirent
-- l'ancienne écriture avant d'écrire la nouvelle, comme avant, et `apply_migration` attend alors une confirmation qui
-- n'arrive pas.

-- ══ 0. Le point de départ : sinon, rien n'est remplacé ══
do $garde$
declare
  f record;
  v_corps text;
  v_avant int := 0;
  v_apres int := 0;
  v_autres text;
begin
  if to_regprocedure('public.compte_du_role(uuid, text)') is null
     or to_regprocedure('public.compte_du_dirigeant(uuid)') is null then
    raise exception 'L''étape PC1 (plan_comptable_des_dossiers) n''est pas en base : rien n''est remplacé.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier) then
    raise exception 'Le plan d''un dossier porte une ligne : cette migration ne serait plus neutre, rien n''est remplacé.';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where name = 'la_base_lit_le_plan_3')
     or exists (select 1 from (values
                     ('ecrire_mouvement_compte_bilan(uuid, text, jsonb)', 'bc4eb98c3ffd47a8a669759d0328795d'),
                     ('rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb)', '566f37f500eb3804c8b09b1a257e3db4')
                   ) as v(f, apres)
                 where md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.' || v.f)),
                                   E'\r\n', E'\n')) is distinct from v.apres) then
    raise exception 'La migration la_base_lit_le_plan_3 n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
  -- Chaque corps remplacé est celui sur lequel cette migration a été écrite (fins de ligne ramenées à \n).
  for f in select * from (values
    ('rapprocher_declaration_tva(uuid, uuid, jsonb)', '16e3f8afc28737a67b990ff05ff99759', 'b9f3a0fe78e84da4abfb7a2291417994'),
    ('ecrire_liquidation_tva(uuid, jsonb)', '92de020c66aed9ecf63f4f100f4aa4e4', '1b785806dc9794555f5d5a0130fac0ed'),
    ('liquidation_attendue(uuid)', '3d07e9e4638bc721668a5c127f266d5d', 'f705e403cc33f231b175f6711f131218')
  ) as v(fonction, avant, apres) loop
    select md5(replace(p.prosrc, E'\r\n', E'\n')) into v_corps
      from pg_proc p where p.oid = to_regprocedure('public.' || f.fonction);
    if v_corps = f.avant then v_avant := v_avant + 1;
    elsif v_corps = f.apres then v_apres := v_apres + 1;
    else v_autres := concat_ws(', ', v_autres, f.fonction);
    end if;
  end loop;
  if v_apres = 3 then
    raise exception 'La migration la_base_lit_le_plan_4 est déjà en base : rien à faire.';
  end if;
  if v_avant <> 3 then
    raise exception 'Une fonction n''est plus celle sur laquelle cette migration a été écrite (%) : rien n''est remplacé.',
      coalesce(v_autres, 'en partie déjà remplacée');
  end if;
end
$garde$;

-- ══ rapprocher_declaration_tva ══
create or replace function public.rapprocher_declaration_tva(p_ligne_bancaire_id uuid, p_declaration_id uuid, p_ecriture jsonb)
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
  v_banque text;
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

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte := public.compte_du_role(v_ligne.dossier_id,
    case when v_ligne.montant < 0 then 'tva_a_decaisser' else 'remboursement_tva_demande' end);
  if jsonb_typeof(p_ecriture) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select v_banque as compte, case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
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
  'Rapproche un mouvement de la déclaration de TVA qu''il paie ou rembourse ET écrit son écriture (le compte du rôle tva_a_decaisser ou remboursement_tva_demande — 445510 ou 445830 par défaut — face à la banque), dans une transaction (ligne 26.8). Rejouée sur un mouvement déjà rapproché d''une déclaration, elle remplace le lien et l''écriture.';

-- ══ ecrire_liquidation_tva ══
create or replace function public.ecrire_liquidation_tva(p_declaration_id uuid, p_ecriture jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_declaration public.declarations_tva%rowtype;
  v_arrondi numeric;
  v_compte_arrondi_charge text;
  v_compte_arrondi_produit text;
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
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_declaration.dossier_id::text, 0));
  v_compte_arrondi_charge := public.compte_du_role(v_declaration.dossier_id, 'arrondi_charge');
  v_compte_arrondi_produit := public.compte_du_role(v_declaration.dossier_id, 'arrondi_produit');
  select coalesce(max(montant), 0) into v_arrondi
    from public.liquidation_attendue(p_declaration_id)
   where compte in (v_compte_arrondi_charge, v_compte_arrondi_produit);
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

-- ══ liquidation_attendue ══
create or replace function public.liquidation_attendue(p_declaration_id uuid)
returns table (compte text, sens text, montant numeric)
language sql
stable
set search_path = public
as $$
  -- Le plan du dossier de la déclaration (ligne 43), lu sous le verrou de l'appelant : `ecrire_liquidation_tva` le
  -- prend en partagé avant de lire cette écriture ; une lecture seule n'écrit rien.
  with d as (
    select dossier_id, tva_collectee as collectee, tva_deductible as deductible,
           tva_deductible_immobilisations as immobilisations,
           coalesce((cases->>'l22')::numeric, 0) as l22, coalesce((cases->>'l26')::numeric, 0) as l26,
           coalesce((cases->>'l27')::numeric, 0) as l27, coalesce((cases->>'l28')::numeric, 0) as l28
      from public.declarations_tva
     where id = p_declaration_id and cases is not null
  ), soldes as (
    select public.compte_du_role(dossier_id, 'tva_collectee') as compte, collectee as solde from d
    union all select public.compte_du_role(dossier_id, 'tva_deductible'), -deductible from d
    union all select public.compte_du_role(dossier_id, 'tva_immobilisations'), -immobilisations from d
    union all select public.compte_du_role(dossier_id, 'credit_tva_a_reporter'), l27 - l22 from d
    union all select public.compte_du_role(dossier_id, 'tva_a_decaisser'), -l28 from d
    union all select public.compte_du_role(dossier_id, 'remboursement_tva_demande'), l26 from d
  ), arrondi as (
    select -sum(solde) as solde from soldes
  ), toutes as (
    select s.compte, s.solde from soldes s
    union all select case when a.solde > 0 then public.compte_du_role(d.dossier_id, 'arrondi_charge')
                          else public.compte_du_role(d.dossier_id, 'arrondi_produit') end, a.solde
      from arrondi a cross join d
  )
  select t.compte, case when t.solde > 0 then 'debit' else 'credit' end, abs(t.solde)
    from toutes t
   where t.solde <> 0
$$;
