-- LA BASE LIT LE PLAN, SANS RIEN CHANGER — ligne 43, étape PC2, migration 3 sur 6 :
-- le mouvement écrit sur un compte de bilan et l'échéance d'emprunt.
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
  if not exists (select 1 from supabase_migrations.schema_migrations where name = 'la_base_lit_le_plan_2')
     or exists (select 1 from (values
                     ('affecter_mouvement_bancaire(uuid, uuid, jsonb, numeric)', 'd6a960d105dc2e317eb2cf71c41259bb'),
                     ('ventiler_mouvement_bancaire(uuid, jsonb, jsonb)', '6972d28e548e9717fdd5f959d38a6e80')
                   ) as v(f, apres)
                 where md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.' || v.f)),
                                   E'\r\n', E'\n')) is distinct from v.apres) then
    raise exception 'La migration la_base_lit_le_plan_2 n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
  -- Chaque corps remplacé est celui sur lequel cette migration a été écrite (fins de ligne ramenées à \n).
  for f in select * from (values
    ('ecrire_mouvement_compte_bilan(uuid, text, jsonb)', 'fdb23e9ef0445eeee04e132b29bb8ac8', 'bc4eb98c3ffd47a8a669759d0328795d'),
    ('rapprocher_echeance_emprunt(uuid, uuid, integer, numeric, numeric, jsonb)', 'e59685d73bbc34d1d4adfc0c51b2db4e', '566f37f500eb3804c8b09b1a257e3db4')
  ) as v(fonction, avant, apres) loop
    select md5(replace(p.prosrc, E'\r\n', E'\n')) into v_corps
      from pg_proc p where p.oid = to_regprocedure('public.' || f.fonction);
    if v_corps = f.avant then v_avant := v_avant + 1;
    elsif v_corps = f.apres then v_apres := v_apres + 1;
    else v_autres := concat_ws(', ', v_autres, f.fonction);
    end if;
  end loop;
  if v_apres = 2 then
    raise exception 'La migration la_base_lit_le_plan_3 est déjà en base : rien à faire.';
  end if;
  if v_avant <> 2 then
    raise exception 'Une fonction n''est plus celle sur laquelle cette migration a été écrite (%) : rien n''est remplacé.',
      coalesce(v_autres, 'en partie déjà remplacée');
  end if;
end
$garde$;

-- ══ ecrire_mouvement_compte_bilan ══
create or replace function public.ecrire_mouvement_compte_bilan(p_ligne_bancaire_id uuid, p_compte text, p_ecritures jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_mode text;
  v_dirigeant text;
  v_banque text;
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

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  -- Le compte du dirigeant se lit dans le dossier, comme pour un virement personnel : celui du rôle `exploitant`
  -- en trésorerie (108000 par défaut), le compte choisi pour lui en engagement.
  select mode_comptable, public.compte_du_dirigeant(id)
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
    select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
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

-- ══ rapprocher_echeance_emprunt ══
create or replace function public.rapprocher_echeance_emprunt(
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
  v_banque text;
  v_compte_emprunt text;
  v_compte_interets text;
  v_compte_assurance text;
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
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte_emprunt := public.compte_du_role(v_ligne.dossier_id, 'emprunt');
  v_compte_interets := public.compte_du_role(v_ligne.dossier_id, 'interets_emprunt');
  v_compte_assurance := public.compte_du_role(v_ligne.dossier_id, 'assurance_emprunt');
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_banque, case when v_ligne.montant > 0 then 'debit' else 'credit' end, v_total),
      (v_compte_emprunt, case when v_ligne.montant > 0 then 'credit' else 'debit' end, v_capital),
      (v_compte_interets, 'debit', v_interets),
      (v_compte_assurance, 'debit', v_assurance)
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
  'Rapproche un mouvement d''une échéance d''emprunt (sortie) ou de son déblocage (entrée) ET écrit son écriture (le capital, les intérêts et l''assurance aux comptes des rôles emprunt, interets_emprunt et assurance_emprunt du plan du dossier — 164000, 661100, 616800 par défaut —, face à la banque), dans une transaction. Le découpage validé se garde sur le mouvement. Rejouée sur un mouvement déjà rapproché d''un emprunt, elle remplace son rapprochement et son écriture.';
