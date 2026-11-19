-- RETOUR DE `autres_impots_des_cotisations` (EXP58-Q6 et EXP58-Q7, supabase/preparees/20261119120000_autres_impots_des_cotisations.sql)
-- — À COLLER par le cabinet dans l'éditeur SQL de Supabase, dans une transaction : il retire une colonne et une ligne du
-- catalogue des rôles, ce que l'outil d'application retient. CE QU'IL DÉTRUIT : la colonne
-- `cotisations_declarees.montant_autres_impots`, et avec elle chaque part « autres impôts » saisie — une information que rien
-- d'autre ne garde dans l'application (l'échéancier de l'Urssaf est hors d'elle) ; et le rôle `autres_impots` du catalogue.
-- C'est pourquoi sa garde refuse dès qu'une échéance porte une part, ou qu'un plan de dossier ou le modèle d'un cabinet
-- règle ce rôle : il ne sert qu'avant la première saisie ; au-delà, retirer ces parts est une décision du cabinet, qui se
-- prend à part. Une écriture passée avec une part, puis cette part retirée, reste au brouillon : « Écrire les N » la
-- réécrit sur l'écriture d'hier (elle se dit « à réécrire »).
-- Il rend la base d'avant : les trois fonctions reprennent leur corps d'hier, au caractère près (vérifiés en fin), et leurs
-- commentaires. Le drapeau (`AUTRES_IMPOTS_DES_COTISATIONS_PREVUS`, src/lib/autresImpotsDesCotisations.ts) se baisse AVANT
-- lui, et la constante de même nom de l'assistant, redéployé : levés, l'écran écrirait une colonne absente, et la lecture du
-- plan exigerait un rôle que la base ne rendrait plus — aucun onglet d'un dossier ne se monterait. Le fichier de la
-- migration quitte ensuite supabase/schema/.
--
-- La garde : la colonne, le rôle et les trois corps sont ceux de la migration, aucune échéance ne porte de part, aucun plan
-- ne règle le rôle.
do $garde$
declare
  v_parts bigint;
  v_plans bigint;
begin
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text, ', ')
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.cotisations_declarees'::regclass and a.attname = 'montant_autres_impots' and not a.attisdropped)
     is distinct from 'montant_autres_impots numeric false false'
     or (select r.racines::text || ' ' || r.compte_defaut || ' ' || r.libelle_defaut || ' ' || coalesce(r.prefixe_auxiliaire_defaut, '-') || ' ' || r.ordre
           from public.roles_comptables r where r.role = 'autres_impots')
        is distinct from '{635,637} 637800 Taxes diverses - 660' then
    raise exception 'Retour d''EXP58-Q6 : la part « autres impôts » n''est pas celle de la migration (absente ou changée) : rien n''est retiré.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname)
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)'),
                       to_regprocedure('public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)'),
                       to_regprocedure('public.garder_paiement_personnel()')))
     is distinct from 'enregistrer_paiement_personnel_cotisation=afd3787e3bdaff1744b4d0b23ed4b1b8,'
                      'garder_paiement_personnel=6419de487f2f90f7f9e5a5b59a689c09,'
                      'rapprocher_cotisation=1335506cd5644999189fb74496a06ea8' then
    raise exception 'Retour d''EXP58-Q6 : une des trois fonctions n''a plus le corps de la migration : rien n''est retiré.';
  end if;
  select count(*) into v_parts from public.cotisations_declarees where montant_autres_impots is not null;
  if v_parts > 0 then
    raise exception 'Retour d''EXP58-Q6 : % échéance(s) portent une part « autres impôts », que ce retour effacerait sans retour possible : rien n''est retiré.',
      v_parts using errcode = '23514';
  end if;
  select (select count(*) from public.plan_comptable_dossier where role = 'autres_impots')
       + (select count(*) from public.plan_comptable_cabinet where role = 'autres_impots') into v_plans;
  if v_plans > 0 then
    raise exception 'Retour d''EXP58-Q6 : % plan(s) de dossier ou modèle(s) de cabinet règlent le rôle des autres impôts : rien n''est retiré.',
      v_plans using errcode = '23514';
  end if;
end
$garde$;

-- ══ 1. Les trois fonctions : leurs corps d'hier ══════════
create or replace function public.rapprocher_cotisation(p_ligne_bancaire_id uuid, p_cotisation_id uuid, p_ecritures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  -- UN MOUVEMENT IGNORÉ ne compte nulle part — ni brouillon, ni FEC, ni 2035 — : il ne paie pas une échéance (REGLES-Q1,
  -- 02/11/2026). Rapproché ici pendant qu'un autre écran l'ignorait, il devenait « rapproché » en silence, avec son
  -- écriture. Après le refus d'un mouvement classé, qui garde ses mots pour un virement personnel, ignoré lui aussi.
  if v_ligne.statut = 'ignoree' then
    raise exception 'Ce mouvement est ignoré : remets-le d''abord à traiter.' using errcode = '22023';
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
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
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
  -- La jambe de banque se tient sur le compte du MOUVEMENT (MCB5) : le 512 de son compte bancaire quand il tient le sien
  -- à sa date, celui du rôle `banque` du plan sinon — un dossier à un seul compte, comme hier.
  v_banque := public.compte_de_banque_du_mouvement(v_ligne.id);
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

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$function$;
comment on function public.rapprocher_cotisation(uuid, uuid, jsonb) is
  'Rapproche un mouvement d''une échéance de cotisation ET écrit son écriture (la cotisation au compte du rôle cotisations_exploitant, sa CSG-CRDS en trésorerie à celui du rôle exploitant — 646000 et 108000 par défaut —, face à la banque, dans le sens du mouvement), dans une transaction. Rejouée sur un mouvement déjà rapproché d''une échéance, elle remplace son rapprochement et son écriture.';

create or replace function public.enregistrer_paiement_personnel_cotisation(
  p_dossier_id uuid,
  p_cotisation_id uuid,
  p_date_paiement date,
  p_ecritures jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cotisation public.cotisations_declarees%rowtype;
  v_mouvement date;
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_frontiere date;
  v_ouverture date;
  v_mode text;
  v_compte text;
  v_compte_cotisations text;
  v_montant numeric;
  v_csg numeric := 0;
  v_net bigint;
  v_sens_charge text;
  v_sens_dirigeant text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_cotisation from public.cotisations_declarees c
   where c.id = p_cotisation_id and c.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Échéance introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_cotisation.paiement_personnel_le is not null then
    raise exception 'Cette échéance est déjà payée depuis le compte personnel, le % : retire d''abord ce paiement.',
      to_char(v_cotisation.paiement_personnel_le, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select l.date into v_mouvement from public.lignes_bancaires l where l.cotisation_id = p_cotisation_id;
  if found then
    raise exception 'Cette échéance est rapprochée du mouvement du % : elle ne se paie pas aussi depuis le compte personnel.',
      to_char(v_mouvement, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- Le verrou partagé du dossier, celui des déclencheurs : une validation en cours finit d'abord, et la frontière lue
  -- ici est celle qu'ils liront.
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_cotisation.echeance <= v_frontiere then
    raise exception '% : cette échéance ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_cotisation.echeance)::integer) using errcode = '23514';
  end if;
  if p_date_paiement is null then
    raise exception 'La date du paiement depuis le compte personnel est à renseigner.' using errcode = '22023';
  end if;
  if p_date_paiement < date '2000-01-01' then
    raise exception 'Un paiement ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date_paiement > v_aujourd_hui then
    raise exception 'Un paiement ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if v_frontiere is not null and p_date_paiement <= v_frontiere then
    raise exception '% : un paiement ne s''y déclare plus.',
      public.exercice_fige(p_dossier_id, extract(year from p_date_paiement)::integer) using errcode = '23514';
  end if;
  select min(a.date) into v_ouverture from public.a_nouveaux a where a.dossier_id = p_dossier_id;
  if v_ouverture is not null and p_date_paiement < v_ouverture then
    raise exception 'Ce paiement précède l''ouverture du dossier, le % : il est dans les comptes repris.',
      to_char(v_ouverture, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  -- Le montant de l'échéance : le versement saisi, sinon l'appel. Son SIGNE dit ce qu'elle est — un appel payé de la
  -- poche de l'exploitant, ou un remboursement reçu sur son compte personnel.
  v_montant := coalesce(v_cotisation.montant_verse, v_cotisation.montant_appele);
  if v_montant = 0 then
    raise exception 'Une échéance de zéro euro n''a rien à payer.' using errcode = '22023';
  end if;
  if v_montant <> round(v_montant, 2) then
    raise exception 'Le montant de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  -- Le compte du dirigeant se lit dans le dossier, jamais dans ce que l'application envoie — la règle du virement
  -- personnel (`classer_virement_personnel`) ; ceux des rôles, dans le plan du dossier (ligne 43), sous le verrou
  -- partagé pris plus haut.
  select d.mode_comptable, public.compte_du_dirigeant(d.id)
    into v_mode, v_compte from public.dossiers d where d.id = p_dossier_id;
  v_compte_cotisations := public.compte_du_role(p_dossier_id, 'cotisations_exploitant');
  if v_mode = 'tresorerie' and v_cotisation.montant_csg_crds is not null then
    v_csg := abs(v_cotisation.montant_csg_crds);
  end if;
  if v_csg <> round(v_csg, 2) then
    raise exception 'La CSG-CRDS de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  if v_csg > abs(v_montant) then
    raise exception 'La CSG-CRDS de cette échéance (% €) dépasse son montant (% €).',
      replace(to_char(v_csg, 'FM999999999990.00'), '.', ','),
      replace(to_char(abs(v_montant), 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- L'écriture attendue, EN CENTIMES ENTIERS : la cotisation hors CSG-CRDS au compte du rôle `cotisations_exploitant`
  -- (646000 par défaut), face au compte du dirigeant ; dans le sens de l'échéance — un appel le débite, un
  -- remboursement le crédite. Comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente, à
  -- l'égalité exacte — un montant reçu qui n'est pas au centime n'égale aucun nombre entier de centimes. Une ligne à
  -- zéro n'en est pas une.
  if jsonb_typeof(p_ecritures) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_ecritures) e(valeur)
                 where jsonb_typeof(e.valeur) is distinct from 'object'
                    or jsonb_typeof(e.valeur -> 'compte') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'sens') is distinct from 'string'
                    or jsonb_typeof(e.valeur -> 'montant') is distinct from 'number') then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  v_net := (abs(v_montant) * 100)::bigint - (v_csg * 100)::bigint;
  v_sens_charge := case when v_montant > 0 then 'debit' else 'credit' end;
  v_sens_dirigeant := case when v_montant > 0 then 'credit' else 'debit' end;
  with attendues as (
    select a.compte, a.sens, a.centimes from (values
      (v_compte_cotisations, v_sens_charge, v_net),
      (v_compte, v_sens_dirigeant, v_net)
    ) as a(compte, sens, centimes)
    where a.centimes > 0
  ), recues as (
    select e.valeur ->> 'compte' as compte, e.valeur ->> 'sens' as sens, (e.valeur ->> 'montant')::numeric * 100 as centimes
    from jsonb_array_elements(p_ecritures) e(valeur)
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, centimes::numeric from attendues
                     except all select compte, sens, centimes from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à cette échéance et au compte du dirigeant (%).', v_compte
      using errcode = '22023';
  end if;

  -- Les déclencheurs ne laissent poser la date du paiement et son écriture qu'à cette fonction, pour cette échéance.
  perform set_config('jd.paiement_personnel', p_cotisation_id::text, true);
  update public.cotisations_declarees set paiement_personnel_le = p_date_paiement where id = p_cotisation_id;
  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id,
                                          declaration_tva_id, cotisation_id, date, compte, libelle, montant, sens, statut)
  select p_dossier_id, null, null, null, null, null, p_cotisation_id, p_date_paiement, e.valeur ->> 'compte',
         coalesce(e.valeur ->> 'libelle', ''), (e.valeur ->> 'montant')::numeric, e.valeur ->> 'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) e(valeur);
  get diagnostics v_nb = row_count;
  perform set_config('jd.paiement_personnel', '', true);

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where cotisation_id = p_cotisation_id;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;
comment on function public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb) is
  'Déclare qu''une échéance de cotisation a été payée depuis le compte personnel de l''exploitant, à la date donnée, ET écrit son écriture (la cotisation hors CSG-CRDS en trésorerie au compte du rôle cotisations_exploitant — 646000 par défaut —, face au compte du dirigeant), dans une transaction. Ne remplace rien : un paiement déjà déclaré se retire d''abord.';

create or replace function public.garder_paiement_personnel() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mouvement date;
begin
  if tg_op = 'INSERT' then
    if new.paiement_personnel_le is null
       or (public.is_super_admin()
           and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
      return new;
    end if;
    raise exception 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'
      using errcode = '42501';
  end if;
  if new.paiement_personnel_le is distinct from old.paiement_personnel_le then
    if coalesce(current_setting('jd.paiement_personnel', true), '') is distinct from old.id::text then
      raise exception 'Une échéance ne se déclare payée depuis le compte personnel que par l''application, avec son écriture.'
        using errcode = '42501';
    end if;
    if new.paiement_personnel_le is not null then
      select l.date into v_mouvement from public.lignes_bancaires l where l.cotisation_id = old.id;
      if found then
        raise exception 'Cette échéance est rapprochée du mouvement du % : elle ne se paie pas aussi depuis le compte personnel.',
          to_char(v_mouvement, 'DD/MM/YYYY') using errcode = '23514';
      end if;
    end if;
  end if;
  if old.paiement_personnel_le is not null and new.paiement_personnel_le is not null
     and (new.montant_appele, new.montant_verse, new.montant_csg_crds, new.dossier_id)
         is distinct from (old.montant_appele, old.montant_verse, old.montant_csg_crds, old.dossier_id) then
    raise exception 'Cette échéance est payée depuis le compte personnel, le % : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.',
      to_char(old.paiement_personnel_le, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ══ 2. Le rôle et la colonne ══════════
delete from public.roles_comptables where role = 'autres_impots';
alter table public.cotisations_declarees drop column montant_autres_impots;

-- ══ 3. La garde de fin : la base d'avant ══════════
do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname)
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)'),
                       to_regprocedure('public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)'),
                       to_regprocedure('public.garder_paiement_personnel()')))
     is distinct from 'enregistrer_paiement_personnel_cotisation=413e4db0288b1507644f381f934ccf6a,'
                      'garder_paiement_personnel=3a165550bb61beb58d478eb9e4de1180,'
                      'rapprocher_cotisation=2559833009639c117795ad40d74dc31f'
     or exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.cotisations_declarees'::regclass
                 and a.attname = 'montant_autres_impots' and not a.attisdropped)
     or exists (select 1 from public.roles_comptables r where r.role = 'autres_impots') then
    raise exception 'Retour d''EXP58-Q6 : la base d''avant n''est pas rendue : rien n''est retiré.';
  end if;
end
$fin$;
