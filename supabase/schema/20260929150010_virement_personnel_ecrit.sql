-- Ligne 26.6 de la feuille de route, étape (a), suite : un VIREMENT PERSONNEL s'écrit sur le compte du
-- dirigeant. Le bouton « Virement personnel » de l'onglet Banque classait le mouvement sans rien
-- écrire : un prélèvement de l'exploitant ne figurait ni dans le brouillon ni dans le FEC, dont le
-- compte 512 ne retrouvait donc pas le relevé. Il s'écrit désormais comme une affectation — le compte
-- du dirigeant face à la banque, au montant, à la date et dans le sens du mouvement —, dans la même
-- transaction que son classement.
--
-- LE COMPTE SE LIT DANS LE DOSSIER, jamais dans ce que l'application envoie : 108000 (compte de
-- l'exploitant) pour un dossier tenu en trésorerie, une entreprise individuelle aux bénéfices non
-- commerciaux ; en engagement, le compte que le cabinet a choisi pour le dirigeant
-- (`compte_notes_de_frais` : 455, 108 ou 467). Il ne peut pas changer sous une écriture existante : le
-- déclencheur `dossiers_verrouiller_modele_comptable` refuse de changer le modèle dès que le brouillon
-- porte une écriture.
--
-- Le mouvement garde le statut « ignorée » et le drapeau `prelevement_personnel` qu'il portait : le
-- classement ne change pas, il s'écrit. L'écriture est composée par l'application
-- (lib/virementPersonnel.ts, testé) ; la base la VÉRIFIE avant de l'écrire, comme pour une affectation
-- (`affecter_mouvement_bancaire`).

create function public.classer_virement_personnel(p_ligne_bancaire_id uuid, p_ecritures jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_compte text;
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
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null then
    raise exception 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou affecté à une catégorie : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  select case when mode_comptable = 'engagement' then compte_notes_de_frais else '108000' end
    into v_compte from public.dossiers where id = v_ligne.dossier_id;

  if jsonb_typeof(p_ecritures) is distinct from 'array' or jsonb_array_length(p_ecritures) < 2 then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  select count(*) filter (where e->>'compte' = '512000'),
         count(*) filter (where e->>'compte' = '512000' and e->>'sens' = v_sens_banque
                            and (e->>'montant')::numeric = abs(v_ligne.montant)),
         count(*) filter (where (e->>'compte') is distinct from '512000' and (e->>'compte') is distinct from v_compte)
    into v_nb_banque, v_nb_banque_juste, v_nb_autres
  from jsonb_array_elements(p_ecritures) as e;
  if v_nb_banque <> 1 or v_nb_banque_juste <> 1 or v_nb_autres > 0 then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (%).', v_compte
      using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'ignoree', prelevement_personnel = true
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

comment on function public.classer_virement_personnel(uuid, jsonb) is
  'Classe un mouvement en virement personnel ET écrit son écriture (compte du dirigeant face à la banque), '
  'dans une transaction. Le compte se lit dans le dossier : 108000 en trésorerie, compte_notes_de_frais en '
  'engagement. Rejouée sur un virement déjà classé, elle remplace son écriture.';

create function public.retirer_virement_personnel(p_ligne_bancaire_id uuid) returns integer
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
  if not v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement n''est pas classé en virement personnel.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set statut = 'non_rapprochee', prelevement_personnel = false
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_virement_personnel(uuid) is
  'Remet à traiter un virement personnel ET retire son écriture, dans une transaction.';

revoke execute on function public.classer_virement_personnel(uuid, jsonb) from public, anon;
grant execute on function public.classer_virement_personnel(uuid, jsonb) to authenticated;
revoke execute on function public.retirer_virement_personnel(uuid) from public, anon;
grant execute on function public.retirer_virement_personnel(uuid) to authenticated;
