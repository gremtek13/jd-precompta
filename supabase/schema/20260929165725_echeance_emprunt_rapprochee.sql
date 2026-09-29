-- Ligne 26.6 de la feuille de route, étape (a), suite : une ÉCHÉANCE D'EMPRUNT s'écrit sur ses comptes.
-- Le prélèvement mensuel d'un prêt mêle ce que la comptabilité sépare : le capital remboursé (164, une
-- dette qui diminue — ni charge ni recette), les intérêts (661, déductibles en frais financiers, ligne
-- 31 de la 2035-A) et souvent l'assurance de l'emprunteur (616, déductible en primes d'assurance). Rien
-- de ce prélèvement n'était écrit, et la 2035 ne comptait aucun intérêt d'emprunt.
--
-- LE DÉCOUPAGE EST VALIDÉ PAR LE CABINET, PAS DÉDUIT. L'application le PROPOSE depuis l'échéancier
-- qu'elle calcule (lib/emprunts.ts) ; la banque a son propre tableau d'amortissement, qui fait foi et
-- peut différer (arrondis, différé, assurance). Ce qui est validé s'écrit ET se garde sur le mouvement :
-- la 2035 le lit là, comme l'écran du client, qui n'a pas accès aux écritures.
--
-- Un mouvement POSITIF rattaché à un emprunt en est le DÉBLOCAGE : les fonds reçus, la banque au débit et
-- le 164 au crédit, sans intérêts ni échéance.
--
-- L'écriture est composée par l'application (lib/echeanceEmprunt.ts, testé) ; la base la VÉRIFIE ligne à
-- ligne contre le mouvement et le découpage, comme une affectation ou un virement personnel.

alter table public.lignes_bancaires
  add column emprunt_id uuid references public.emprunts(id);
alter table public.lignes_bancaires
  add column emprunt_echeance integer;
alter table public.lignes_bancaires
  add column emprunt_interets numeric(12,2);
alter table public.lignes_bancaires
  add column emprunt_assurance numeric(12,2);

comment on column public.lignes_bancaires.emprunt_id is
  'Emprunt dont le mouvement est une échéance (sortie) ou le déblocage (entrée). Exclusif d''une pièce, '
  'd''une cotisation et d''une catégorie (lignes_bancaires_un_seul_rapprochement). Écrit avec son écriture '
  'par rapprocher_echeance_emprunt, retiré avec elle par retirer_echeance_emprunt. Sans action à la '
  'suppression : un emprunt dont une échéance est rapprochée ne se supprime pas.';
comment on column public.lignes_bancaires.emprunt_echeance is
  'Numéro de l''échéance dans l''échéancier de l''emprunt (1 à sa durée en mois). Nul pour un déblocage.';
comment on column public.lignes_bancaires.emprunt_interets is
  'Intérêts compris dans l''échéance, tels que le cabinet les a validés (compte 661100, frais financiers de '
  'la 2035). Zéro pour un déblocage.';
comment on column public.lignes_bancaires.emprunt_assurance is
  'Assurance et frais compris dans l''échéance (compte 616800, primes d''assurance de la 2035). Le capital '
  'remboursé est le reste du prélèvement. Zéro pour un déblocage.';

create index lignes_bancaires_emprunt_id_idx on public.lignes_bancaires (emprunt_id);

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id) <= 1);

alter table public.lignes_bancaires add constraint lignes_bancaires_emprunt_rapproche
  check (emprunt_id is null or (statut = 'rapprochee' and not prelevement_personnel));

-- Le découpage suit le signe du mouvement, et la base le tient sans le code. Chaque colonne est testée
-- NON NULLE avant d'être comparée : un CHECK dont l'expression vaut NULL PASSE, donc une échéance sans
-- numéro ou sans intérêts serait acceptée par « emprunt_echeance >= 1 » seul.
alter table public.lignes_bancaires add constraint lignes_bancaires_decoupage_emprunt check (
  (emprunt_id is null and emprunt_echeance is null and emprunt_interets is null and emprunt_assurance is null)
  or (
    emprunt_id is not null and emprunt_interets is not null and emprunt_assurance is not null
    and emprunt_interets >= 0 and emprunt_assurance >= 0
    and (
      (montant < 0 and emprunt_echeance is not null and emprunt_echeance >= 1
        and emprunt_interets + emprunt_assurance <= -montant)
      or (montant > 0 and emprunt_echeance is null and emprunt_interets = 0 and emprunt_assurance = 0)
    )
  )
);

-- Une échéance ne se paie qu'une fois. Contrainte TOTALE : deux NULL ne sont jamais égaux, donc les
-- mouvements sans emprunt et les déblocages (sans numéro) ne se gênent pas.
alter table public.lignes_bancaires add constraint lignes_bancaires_echeance_emprunt_unique
  unique (emprunt_id, emprunt_echeance);

create function public.rapprocher_echeance_emprunt(
  p_ligne_bancaire_id uuid,
  p_emprunt_id uuid,
  p_echeance integer,
  p_interets numeric,
  p_assurance numeric,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_emprunt public.emprunts%rowtype;
  v_total numeric;
  v_capital numeric;
  v_interets numeric := coalesce(p_interets, 0);
  v_assurance numeric := coalesce(p_assurance, 0);
  v_date_autre date;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une cotisation, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  select * into v_emprunt from public.emprunts where id = p_emprunt_id and dossier_id = v_ligne.dossier_id;
  if not found then
    raise exception 'Cet emprunt n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  v_total := abs(v_ligne.montant);
  if v_ligne.montant < 0 then
    if p_echeance is null or p_echeance < 1 or p_echeance > v_emprunt.duree_mois then
      raise exception 'L''échéance doit être comprise entre 1 et % pour cet emprunt.', v_emprunt.duree_mois
        using errcode = '22023';
    end if;
    if v_interets < 0 or v_assurance < 0 or v_interets + v_assurance > v_total
       or v_interets <> round(v_interets, 2) or v_assurance <> round(v_assurance, 2) then
      raise exception 'Découpage impossible : les intérêts et l''assurance sont positifs, au centime, et ne dépassent pas le prélèvement.'
        using errcode = '22023';
    end if;
    select l.date into v_date_autre from public.lignes_bancaires l
     where l.emprunt_id = p_emprunt_id and l.emprunt_echeance = p_echeance and l.id <> p_ligne_bancaire_id;
    if found then
      raise exception 'L''échéance n° % de cet emprunt est déjà rapprochée du mouvement du %.',
        p_echeance, to_char(v_date_autre, 'DD/MM/YYYY') using errcode = '23505';
    end if;
    v_capital := v_total - v_interets - v_assurance;
  else
    if p_echeance is not null or v_interets <> 0 or v_assurance <> 0 then
      raise exception 'Un encaissement rattaché à un emprunt en est le déblocage : ni échéance, ni intérêts, ni assurance.'
        using errcode = '22023';
    end if;
    v_capital := v_total;
  end if;

  -- L'écriture attendue, ligne à ligne ; une ligne à zéro n'en est pas une (une échéance sans assurance,
  -- un différé qui ne rembourse aucun capital). Comparée en MULTIENSEMBLE : autant de lignes, et chacune
  -- des attendues présente — une ligne de trop, un montant faux ou un compte inattendu font refuser.
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      ('512000', case when v_ligne.montant > 0 then 'debit' else 'credit' end, v_total),
      ('164000', case when v_ligne.montant > 0 then 'credit' else 'debit' end, v_capital),
      ('661100', 'debit', v_interets),
      ('616800', 'debit', v_assurance)
    ) as a(compte, sens, montant)
    where a.montant > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee',
         emprunt_id = p_emprunt_id,
         emprunt_echeance = case when v_ligne.montant < 0 then p_echeance end,
         emprunt_interets = case when v_ligne.montant < 0 then v_interets else 0 end,
         emprunt_assurance = case when v_ligne.montant < 0 then v_assurance else 0 end
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
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

comment on function public.rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb) is
  'Rapproche un mouvement d''une échéance d''emprunt (sortie) ou de son déblocage (entrée) ET écrit son '
  'écriture (164000 capital, 661100 intérêts, 616800 assurance, face à la banque), dans une transaction. '
  'Le découpage validé se garde sur le mouvement. Rejouée sur un mouvement déjà rapproché d''un emprunt, '
  'elle remplace son rapprochement et son écriture.';

create function public.retirer_echeance_emprunt(p_ligne_bancaire_id uuid) returns integer
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
  if v_ligne.emprunt_id is null then
    raise exception 'Ce mouvement n''est rapproché d''aucun emprunt.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', emprunt_id = null, emprunt_echeance = null,
         emprunt_interets = null, emprunt_assurance = null
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_echeance_emprunt(uuid) is
  'Annule le rapprochement d''un mouvement avec un emprunt ET retire son écriture, dans une transaction.';

revoke execute on function public.rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb) from public, anon;
grant execute on function public.rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb) to authenticated;
revoke execute on function public.retirer_echeance_emprunt(uuid) from public, anon;
grant execute on function public.retirer_echeance_emprunt(uuid) to authenticated;
