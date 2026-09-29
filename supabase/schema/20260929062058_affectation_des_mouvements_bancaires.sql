-- Ligne 26.6 de la feuille de route, étape (a) : un mouvement bancaire SANS justificatif s'affecte à
-- une catégorie — frais bancaires, encaissements de l'Assurance maladie, remboursements. Jusqu'ici
-- seul un mouvement rapproché d'une pièce produisait une écriture : tout le reste n'était écrit nulle
-- part, ni dans le brouillon, ni dans le FEC, ni dans la 2035.
--
-- L'affectation et son écriture s'écrivent ENSEMBLE, dans une seule transaction : un mouvement affecté
-- sans écriture compterait dans la 2035 et pas dans le FEC, une écriture sans affectation l'inverse.
-- Deux livrables, deux réponses pour le même euro. L'écriture est composée côté application
-- (lib/affectationBanque.ts, testé) ; la base la VÉRIFIE contre le mouvement et la catégorie, puis
-- l'écrit avec l'affectation.

alter table public.lignes_bancaires
  add column categorie_id uuid references public.categories(id);

comment on column public.lignes_bancaires.categorie_id is
  'Catégorie (compte de charge ou de produit, poste 2035) d''un mouvement sans justificatif. Exclusive '
  'd''une pièce et d''une échéance (lignes_bancaires_un_seul_rapprochement). Écrite avec son écriture par '
  'affecter_mouvement_bancaire, retirée avec elle par retirer_affectation_mouvement_bancaire. Sans action '
  'à la suppression : une catégorie en usage ne se supprime pas.';

create index lignes_bancaires_categorie_id_idx on public.lignes_bancaires (categorie_id);

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id) <= 1);

alter table public.lignes_bancaires add constraint lignes_bancaires_affectation_rapprochee
  check (categorie_id is null or (statut = 'rapprochee' and not prelevement_personnel));

create function public.affecter_mouvement_bancaire(
  p_ligne_bancaire_id uuid,
  p_categorie_id uuid,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_categorie public.categories%rowtype;
  v_assujetti boolean;
  v_sens_banque text;
  v_nb_banque integer;
  v_nb_banque_juste integer;
  v_nb_autres integer;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  select * into v_categorie from public.categories where id = p_categorie_id;
  if not found or (v_categorie.dossier_id is not null and v_categorie.dossier_id <> v_ligne.dossier_id) then
    raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  if v_categorie.compte_comptable is null or v_categorie.compte_comptable !~ '^[67][0-9]{2}' then
    raise exception 'La catégorie « % » n''a pas de compte de charge ou de produit (classe 6 ou 7).', v_categorie.libelle
      using errcode = '22023';
  end if;
  select assujetti_tva into v_assujetti from public.dossiers where id = v_ligne.dossier_id;
  if v_assujetti and v_categorie.compte_comptable ~ '^7' then
    raise exception 'Sur un dossier assujetti à la TVA, une recette sans facture n''est pas encore prise en charge : sa TVA ne serait pas calculée. Dépose la facture et rapproche-la.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_ecritures) is distinct from 'array' or jsonb_array_length(p_ecritures) < 2 then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_sens_banque := case when v_ligne.montant >= 0 then 'debit' else 'credit' end;
  select count(*) filter (where e->>'compte' = '512000'),
         count(*) filter (where e->>'compte' = '512000' and e->>'sens' = v_sens_banque
                            and (e->>'montant')::numeric = abs(v_ligne.montant)),
         count(*) filter (where (e->>'compte') is distinct from '512000'
                            and (e->>'compte') is distinct from v_categorie.compte_comptable)
    into v_nb_banque, v_nb_banque_juste, v_nb_autres
  from jsonb_array_elements(p_ecritures) as e;
  if v_nb_banque <> 1 or v_nb_banque_juste <> 1 or v_nb_autres > 0 then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set categorie_id = p_categorie_id, statut = 'rapprochee'
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

create function public.retirer_affectation_mouvement_bancaire(p_ligne_bancaire_id uuid) returns integer
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
  if v_ligne.categorie_id is null then
    raise exception 'Ce mouvement n''est affecté à aucune catégorie.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set categorie_id = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

revoke execute on function public.affecter_mouvement_bancaire(uuid, uuid, jsonb) from public, anon;
grant execute on function public.affecter_mouvement_bancaire(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_affectation_mouvement_bancaire(uuid) from public, anon;
grant execute on function public.retirer_affectation_mouvement_bancaire(uuid) to authenticated;
