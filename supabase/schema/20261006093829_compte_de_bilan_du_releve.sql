-- Ligne 26.7 de la feuille de route : un mouvement du relevé vers un COMPTE DE BILAN s'écrit. L'affectation
-- d'un mouvement refuse un compte de bilan, et seuls quelques-uns avaient un chemin à eux (le virement personnel
-- au compte du dirigeant, l'emprunt au 164, la cotisation, l'acquisition d'un bien) : un virement vers un compte
-- d'épargne ou un dépôt de garantie versé ou rendu ne pouvait qu'être ignoré, et manquait au FEC — le 512 du
-- brouillon s'écartait du relevé. Décision du cabinet du 06/10/2026 : le virement entre comptes au 580000, le
-- dépôt de garantie au 275000, et un compte de bilan au choix, sous les contrôles de l'application.
--
-- LE COMPTE SE GARDE SUR LE MOUVEMENT, et l'écriture s'écrit AVEC lui, dans une transaction : le compte choisi
-- face à la banque, au montant, à la date et dans le sens du mouvement — ni charge ni recette, la 2035 ne le
-- voit pas. L'écriture est composée par l'application (lib/compteDeBilan.ts, testé) ; la base la VÉRIFIE, et
-- refait les refus de l'écran dans le même ordre : le compte du relevé (512) et les autres comptes de trésorerie
-- (ils se relient par le 580000), celui du dirigeant et le 108 (« Virement personnel »), le 164 (l'emprunt), les
-- comptes de fournisseurs et de clients (la facture), la TVA (sa déclaration), les immobilisations (le
-- registre), les amortissements et dépréciations, les stocks, les réserves, le report à nouveau et le résultat,
-- les provisions, les comptes d'attente (un mouvement qu'on ne sait pas classer reste à traiter, sans quoi il
-- échapperait à la validation), les comptes de régularisation, et ce qu'aucune écriture de l'application ne
-- solderait — en trésorerie un salaire, une cotisation ou un impôt sont des charges, en engagement la paie et
-- les impôts autres que sur les bénéfices passent par une écriture qu'elle ne fait pas.

alter table public.lignes_bancaires add column compte_bilan text;

comment on column public.lignes_bancaires.compte_bilan is
  'Le compte de bilan sur lequel un mouvement sans justificatif est écrit (ligne 26.7) : 580000 pour un virement '
  'entre comptes, 275000 pour un dépôt de garantie, ou un compte choisi par le cabinet. Posé avec son écriture par '
  'ecrire_mouvement_compte_bilan, retiré avec elle par retirer_mouvement_compte_bilan. Exclusif de tout autre lien '
  '(lignes_bancaires_un_seul_rapprochement), sur un mouvement rapproché et jamais personnel '
  '(lignes_bancaires_compte_bilan_rapproche).';

-- Six à dix chiffres, classe 1 à 5, et jamais le compte du relevé lui-même : une écriture 512 contre 512 ne
-- dirait rien. Les autres refus dépendent du dossier (le compte du dirigeant, le modèle comptable) : la fonction
-- les tient.
alter table public.lignes_bancaires add constraint lignes_bancaires_compte_bilan_format
  check (compte_bilan is null or (compte_bilan ~ '^[1-5][0-9]{5,9}$' and compte_bilan !~ '^512'));

alter table public.lignes_bancaires add constraint lignes_bancaires_compte_bilan_rapproche
  check (compte_bilan is null or (statut = 'rapprochee' and not prelevement_personnel));

alter table public.lignes_bancaires drop constraint lignes_bancaires_un_seul_rapprochement;
alter table public.lignes_bancaires add constraint lignes_bancaires_un_seul_rapprochement
  check (num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan,
                      nullif(ventilee, false), nullif(reglement_groupe, false)) <= 1);

-- Pourquoi ce compte ne peut pas recevoir ce mouvement, dans l'ordre de `refusCompteDeBilan`
-- (lib/compteDeBilan.ts). Nul quand il le peut.
create function public.refus_compte_de_bilan(p_compte text, p_mode text, p_dirigeant text) returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_compte is null or p_compte !~ '^[0-9]{6,10}$'
      then 'Ce numéro de compte n''a pas la forme d''un compte de l''application : six à dix chiffres.'
    when p_compte ~ '^[67]'
      then 'Un compte de charge ou de produit (classe 6 ou 7) s''affecte par une catégorie.'
    when p_compte !~ '^[1-5]'
      then 'Un compte de bilan est de classe 1 à 5.'
    when p_compte ~ '^512'
      then 'Le 512 est le compte du relevé lui-même. Un virement vers un autre compte du professionnel (épargne, second compte bancaire) s''écrit au 580000, virements internes.'
    when p_compte ~ '^5[1-4]'
      then 'Un virement vers un autre compte de trésorerie du professionnel (autre banque, caisse, chèques postaux, régie d''avances) s''écrit au 580000, virements internes.'
    when p_compte = p_dirigeant or p_compte ~ '^108'
      then format('Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (%s).', p_dirigeant)
    when p_compte ~ '^164'
      then 'Une échéance ou un déblocage d''emprunt se rapproche de son emprunt, qui sépare le capital, les intérêts et l''assurance : « Rapprocher d''un emprunt ».'
    when p_compte ~ '^4[01]'
      then 'Un compte de fournisseur ou de client se solde en rapprochant la facture du mouvement.'
    when p_compte ~ '^445'
      then 'Un compte de TVA ne se choisit pas ici : la TVA se solde par sa déclaration, à laquelle son paiement et le remboursement d''un crédit se rattachent — ce chemin n''existe pas encore.'
    when p_compte ~ '^2[012]'
      then 'Un bien s''inscrit au registre des immobilisations depuis sa facture : son acquisition s''écrit sur le compte de sa nature, et il s''amortit.'
    when p_compte ~ '^(2[89]|39|49|59)'
      then 'Un compte d''amortissement ou de dépréciation ne reçoit pas un mouvement de banque.'
    when p_compte ~ '^3'
      then 'Un compte de stock ne reçoit pas un mouvement de banque : le stock se constate à l''inventaire.'
    when p_compte ~ '^(10[5-7]|1[12])'
      then 'Les réserves, les écarts de réévaluation ou d''équivalence, le report à nouveau et le résultat ne reçoivent pas un mouvement de banque : ils naissent de l''affectation du résultat ou d''une écriture d''inventaire.'
    when p_compte ~ '^1[45]'
      then 'Une provision ne reçoit pas un mouvement de banque : elle se constate à l''inventaire.'
    when p_compte ~ '^47'
      then 'Un compte transitoire ou d''attente ne garde pas un mouvement : un mouvement qu''on ne sait pas encore classer reste à traiter, et l''exercice ne se valide qu''une fois tout classé.'
    when p_compte ~ '^(468|48)'
      then 'Un compte de régularisation (charges à payer, produits à recevoir, charges ou produits constatés d''avance) ne reçoit pas un mouvement de banque : il se passe à l''inventaire.'
    when p_mode = 'tresorerie' and p_compte ~ '^4[234]'
      then 'En comptabilité de trésorerie, un salaire, une cotisation ou un impôt payés sont des charges : range le paiement dans une catégorie. L''impôt sur le revenu de l''exploitant est un virement personnel.'
    when p_mode = 'engagement' and p_compte ~ '^4[234]' and p_compte !~ '^444'
      then 'L''application ne passe pas l''écriture qui solderait ce compte (paie, impôts et taxes) : range le paiement dans une catégorie de charge.'
  end
$$;

comment on function public.refus_compte_de_bilan(text, text, text) is
  'Pourquoi un compte ne peut pas recevoir un mouvement du relevé (ligne 26.7), nul quand il le peut. Même ordre '
  'et mêmes raisons que refusCompteDeBilan (lib/compteDeBilan.ts).';

create function public.ecrire_mouvement_compte_bilan(p_ligne_bancaire_id uuid, p_compte text, p_ecritures jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_mode text;
  v_dirigeant text;
  v_refus text;
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
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
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

  -- Le compte du dirigeant se lit dans le dossier, comme pour un virement personnel : 108000 en trésorerie, le
  -- compte choisi pour lui en engagement.
  select mode_comptable, case when mode_comptable = 'engagement' then compte_notes_de_frais else '108000' end
    into v_mode, v_dirigeant from public.dossiers where id = v_ligne.dossier_id;
  v_refus := public.refus_compte_de_bilan(p_compte, v_mode, v_dirigeant);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, le compte choisi en face. Comparée en
  -- MULTIENSEMBLE, comme celle d'une affectation : autant de lignes, et chacune des attendues présente.
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select '512000'::text as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select p_compte, v_sens_compte, abs(v_ligne.montant)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à ce compte.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set compte_bilan = p_compte, statut = 'rapprochee'
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

comment on function public.ecrire_mouvement_compte_bilan(uuid, text, jsonb) is
  'Écrit un mouvement sans justificatif sur un compte de bilan ET son écriture (le compte face à la banque), dans '
  'une transaction (ligne 26.7). Refait les refus de refusCompteDeBilan. Rejouée sur un mouvement déjà écrit sur '
  'un compte de bilan, elle remplace le compte et l''écriture.';

create function public.retirer_mouvement_compte_bilan(p_ligne_bancaire_id uuid) returns integer
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
  if v_ligne.compte_bilan is null then
    raise exception 'Ce mouvement n''est écrit sur aucun compte de bilan.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se retire plus.' using errcode = '23514';
  end if;

  update public.lignes_bancaires
     set compte_bilan = null, statut = 'non_rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null;
  get diagnostics v_nb = row_count;
  return v_nb;
end;
$$;

comment on function public.retirer_mouvement_compte_bilan(uuid) is
  'Remet à traiter un mouvement écrit sur un compte de bilan ET retire son écriture, dans une transaction.';

revoke execute on function public.refus_compte_de_bilan(text, text, text) from public, anon;
grant execute on function public.refus_compte_de_bilan(text, text, text) to authenticated;
revoke execute on function public.ecrire_mouvement_compte_bilan(uuid, text, jsonb) from public, anon;
grant execute on function public.ecrire_mouvement_compte_bilan(uuid, text, jsonb) to authenticated;
revoke execute on function public.retirer_mouvement_compte_bilan(uuid) from public, anon;
grant execute on function public.retirer_mouvement_compte_bilan(uuid) to authenticated;
