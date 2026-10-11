-- LA BASE LIT LE PLAN, SANS RIEN CHANGER — ligne 43, étape PC2, migration 5 sur 6 :
-- la cotisation rapprochée et le virement personnel.
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
  if not exists (select 1 from supabase_migrations.schema_migrations where name = 'la_base_lit_le_plan_4')
     or exists (select 1 from (values
                     ('rapprocher_declaration_tva(uuid, uuid, jsonb)', 'b9f3a0fe78e84da4abfb7a2291417994'),
                     ('ecrire_liquidation_tva(uuid, jsonb)', '1b785806dc9794555f5d5a0130fac0ed'),
                     ('liquidation_attendue(uuid)', 'f705e403cc33f231b175f6711f131218')
                   ) as v(f, apres)
                 where md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.' || v.f)),
                                   E'\r\n', E'\n')) is distinct from v.apres) then
    raise exception 'La migration la_base_lit_le_plan_4 n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
  -- Chaque corps remplacé est celui sur lequel cette migration a été écrite (fins de ligne ramenées à \n).
  for f in select * from (values
    ('rapprocher_cotisation(uuid, uuid, jsonb)', '2f7f4954d63ebc208b7c344f6895715e', 'ebb4427fc199c5f04e570621ef8c69e3'),
    ('classer_virement_personnel(uuid, jsonb)', 'a558a9442bdad0ca7be04f75143cb6d1', 'a65e86eb912525ffc0eeae6dad2e3380')
  ) as v(fonction, avant, apres) loop
    select md5(replace(p.prosrc, E'\r\n', E'\n')) into v_corps
      from pg_proc p where p.oid = to_regprocedure('public.' || f.fonction);
    if v_corps = f.avant then v_avant := v_avant + 1;
    elsif v_corps = f.apres then v_apres := v_apres + 1;
    else v_autres := concat_ws(', ', v_autres, f.fonction);
    end if;
  end loop;
  if v_apres = 2 then
    raise exception 'La migration la_base_lit_le_plan_5 est déjà en base : rien à faire.';
  end if;
  if v_avant <> 2 then
    raise exception 'Une fonction n''est plus celle sur laquelle cette migration a été écrite (%) : rien n''est remplacé.',
      coalesce(v_autres, 'en partie déjà remplacée');
  end if;
end
$garde$;

-- ══ rapprocher_cotisation ══
create or replace function public.rapprocher_cotisation(
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
  v_banque text;
  v_compte_cotisations text;
  v_compte_exploitant text;
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

  -- La CSG-CRDS au compte de l'exploitant (108000 par défaut), en trésorerie seulement, et au centime : sa valeur
  -- absolue, dans le sens du mouvement. Elle ne peut pas dépasser le mouvement — la cotisation serait négative.
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
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte_cotisations := public.compte_du_role(v_ligne.dossier_id, 'cotisations_exploitant');
  v_compte_exploitant := public.compte_du_role(v_ligne.dossier_id, 'exploitant');
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_banque, v_sens_banque, v_total),
      (v_compte_cotisations, v_sens_compte, v_total - v_csg),
      (v_compte_exploitant, v_sens_compte, v_csg)
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
  'Rapproche un mouvement d''une échéance de cotisation ET écrit son écriture (la cotisation au compte du rôle cotisations_exploitant, sa CSG-CRDS en trésorerie à celui du rôle exploitant — 646000 et 108000 par défaut —, face à la banque, dans le sens du mouvement), dans une transaction. Rejouée sur un mouvement déjà rapproché d''une échéance, elle remplace son rapprochement et son écriture.';

-- ══ classer_virement_personnel ══
create or replace function public.classer_virement_personnel(p_ligne_bancaire_id uuid, p_ecritures jsonb) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_compte text;
  v_banque text;
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

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte := public.compte_du_dirigeant(v_ligne.dossier_id);

  if jsonb_typeof(p_ecritures) is distinct from 'array' or jsonb_array_length(p_ecritures) < 2 then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  select count(*) filter (where e->>'compte' = v_banque),
         count(*) filter (where e->>'compte' = v_banque and e->>'sens' = v_sens_banque
                            and (e->>'montant')::numeric = abs(v_ligne.montant)),
         count(*) filter (where (e->>'compte') is distinct from v_banque and (e->>'compte') is distinct from v_compte)
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
  'Classe un mouvement en virement personnel ET écrit son écriture (compte du dirigeant face à la banque), dans une transaction. Les comptes se lisent dans le dossier et son plan (ligne 43) : celui du rôle exploitant en trésorerie (108000 par défaut), compte_notes_de_frais en engagement ; la banque, celui du rôle banque. Rejouée sur un virement déjà classé, elle remplace son écriture.';
