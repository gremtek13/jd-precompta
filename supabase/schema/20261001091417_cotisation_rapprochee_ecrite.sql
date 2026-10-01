-- Ligne 26.6 de la feuille de route, étape (b) : une ÉCHÉANCE DE COTISATION rapprochée d'un mouvement
-- s'écrit sur ses comptes. Le rapprochement ne posait que le lien : ni écriture au brouillon ni ligne au
-- FEC, et le compte 512 de l'application ne retrouvait pas le prélèvement de l'Urssaf.
--
-- CE QUI S'ÉCRIT, à la date et dans le sens du mouvement : la cotisation au 646000 (cotisations sociales
-- personnelles de l'exploitant), face à la banque. En TRÉSORERIE (BNC), la CSG-CRDS de l'échéance, quand
-- elle est saisie, passe ENTIÈRE au 108000 (compte de l'exploitant) : c'est ce que fait l'expert-comptable
-- du cabinet sur une 2035 déposée — la part déductible est réintroduite en BV hors comptabilité, la part
-- non déductible n'apparaît nulle part. En ENGAGEMENT (BIC, IS), tout va au 646000 : la cotisation est une
-- charge de l'entreprise, et la part non déductible d'un exploitant se réintègre sur la liasse.
--
-- UN PRÉLÈVEMENT PAIE UNE ÉCHÉANCE POSITIVE (un appel), UN ENCAISSEMENT REÇOIT UNE ÉCHÉANCE NÉGATIVE (un
-- remboursement) : le sens se vérifie, et l'écriture le suit — un remboursement crédite le 646000.
--
-- L'écriture est composée par l'application (lib/cotisationRapprochee.ts, testé) ; la base la VÉRIFIE ligne
-- à ligne contre le mouvement, l'échéance et le modèle du dossier, puis l'écrit AVEC le rapprochement,
-- dans une transaction (voir supabase/essais/cotisationRapprochee.sql).

alter table public.lignes_bancaires add constraint lignes_bancaires_cotisation_rapprochee
  check (cotisation_id is null or (statut = 'rapprochee' and not prelevement_personnel));

-- Une échéance se paie une fois. Contrainte TOTALE : deux NULL ne sont jamais égaux, donc les mouvements
-- sans cotisation ne se gênent pas.
alter table public.lignes_bancaires add constraint lignes_bancaires_cotisation_unique unique (cotisation_id);

create function public.rapprocher_cotisation(
  p_ligne_bancaire_id uuid,
  p_cotisation_id uuid,
  p_ecritures jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_cotisation public.cotisations_declarees%rowtype;
  v_mode text;
  v_echeance numeric;
  v_total numeric;
  v_csg numeric := 0;
  v_date_autre date;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.categorie_id is not null or v_ligne.emprunt_id is not null
     or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;

  select * into v_cotisation from public.cotisations_declarees
   where id = p_cotisation_id and dossier_id = v_ligne.dossier_id for update;
  if not found then
    raise exception 'Cette échéance n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  -- Le montant de l'échéance : le versement saisi, sinon l'appel. Son SIGNE dit ce qu'elle est.
  v_echeance := coalesce(v_cotisation.montant_verse, v_cotisation.montant_appele);
  if v_echeance = 0 then
    raise exception 'Une échéance de zéro euro ne se rapproche pas.' using errcode = '22023';
  end if;
  if v_echeance > 0 and v_ligne.montant > 0 then
    raise exception 'Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d''une échéance négative.'
      using errcode = '22023';
  end if;
  if v_echeance < 0 and v_ligne.montant < 0 then
    raise exception 'Cette échéance est négative — un remboursement : un prélèvement ne la paie pas.' using errcode = '22023';
  end if;
  select l.date into v_date_autre from public.lignes_bancaires l
   where l.cotisation_id = p_cotisation_id and l.id <> p_ligne_bancaire_id;
  if found then
    raise exception 'Cette échéance est déjà rapprochée du mouvement du %.', to_char(v_date_autre, 'DD/MM/YYYY')
      using errcode = '23505';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- La CSG-CRDS au 108000, en trésorerie seulement, et au centime : sa valeur absolue, dans le sens du
  -- mouvement. Elle ne peut pas dépasser le mouvement — le 646000 serait négatif.
  v_total := abs(v_ligne.montant);
  select mode_comptable into v_mode from public.dossiers where id = v_ligne.dossier_id;
  if v_mode = 'tresorerie' and v_cotisation.montant_csg_crds is not null then
    v_csg := abs(v_cotisation.montant_csg_crds);
  end if;
  if v_csg <> round(v_csg, 2) then
    raise exception 'La CSG-CRDS de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  if v_csg > v_total then
    raise exception 'La CSG-CRDS de cette échéance (% €) dépasse le mouvement (% €).',
      replace(to_char(v_csg, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente.
  -- Une ligne à zéro n'en est pas une (une échéance sans CSG-CRDS saisie, ou faite toute de CSG-CRDS).
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      ('512000', v_sens_banque, v_total),
      ('646000', v_sens_compte, v_total - v_csg),
      ('108000', v_sens_compte, v_csg)
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
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', cotisation_id = p_cotisation_id
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

comment on function public.rapprocher_cotisation(uuid, uuid, jsonb) is
  'Rapproche un mouvement d''une échéance de cotisation ET écrit son écriture (646000 la cotisation, 108000 '
  'sa CSG-CRDS en trésorerie, face à la banque, dans le sens du mouvement), dans une transaction. Rejouée '
  'sur un mouvement déjà rapproché d''une échéance, elle remplace son rapprochement et son écriture.';

create function public.retirer_rapprochement_cotisation(p_ligne_bancaire_id uuid) returns integer
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
  if v_ligne.cotisation_id is null then
    raise exception 'Ce mouvement n''est rapproché d''aucune échéance de cotisation.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires set statut = 'non_rapprochee', cotisation_id = null where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_rapprochement_cotisation(uuid) is
  'Annule le rapprochement d''un mouvement avec une échéance de cotisation ET retire son écriture, dans une '
  'transaction : le mouvement redevient à traiter.';

-- SUPPRIMER UNE ÉCHÉANCE défait d'abord le rapprochement du mouvement qui la paie, et son écriture. La clé
-- `lignes_bancaires.cotisation_id` est en ON DELETE SET NULL : une suppression directe laisserait le
-- mouvement « rapproché » sans plus rien qui le justifie, et son écriture au brouillon. Ici le mouvement
-- redevient à traiter, sans écriture, et l'échéance part — dans une transaction.
create function public.supprimer_echeance_cotisation(p_cotisation_id uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cotisation public.cotisations_declarees%rowtype;
  v_ligne public.lignes_bancaires%rowtype;
  v_nb integer;
begin
  select * into v_cotisation from public.cotisations_declarees where id = p_cotisation_id for update;
  if not found or not admin_du_dossier(v_cotisation.dossier_id) then
    raise exception 'Accès refusé à cette échéance.' using errcode = '42501';
  end if;

  select * into v_ligne from public.lignes_bancaires where cotisation_id = p_cotisation_id for update;
  if found then
    if exists (
      select 1 from public.ecritures_brouillon
      where ligne_bancaire_id = v_ligne.id and piece_id is null and statut <> 'proposee'
    ) then
      raise exception 'L''écriture du mouvement qui paie cette échéance est validée : l''échéance ne se supprime plus.'
        using errcode = '23514';
    end if;
    update public.lignes_bancaires set statut = 'non_rapprochee', cotisation_id = null where id = v_ligne.id;
    delete from public.ecritures_brouillon where ligne_bancaire_id = v_ligne.id and piece_id is null;
  end if;

  delete from public.cotisations_declarees where id = p_cotisation_id;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.supprimer_echeance_cotisation(uuid) is
  'Supprime une échéance de cotisation, après avoir remis à traiter le mouvement qui la paie et retiré son '
  'écriture, dans une transaction.';

revoke execute on function public.rapprocher_cotisation(uuid, uuid, jsonb) from public, anon;
grant execute on function public.rapprocher_cotisation(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_rapprochement_cotisation(uuid) from public, anon;
grant execute on function public.retirer_rapprochement_cotisation(uuid) to authenticated;
revoke execute on function public.supprimer_echeance_cotisation(uuid) from public, anon;
grant execute on function public.supprimer_echeance_cotisation(uuid) to authenticated;
