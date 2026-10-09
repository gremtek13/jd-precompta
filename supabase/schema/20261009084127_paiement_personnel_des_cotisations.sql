-- UNE ÉCHÉANCE DE COTISATION PAYÉE DEPUIS LE COMPTE PERSONNEL DE L'EXPLOITANT S'ÉCRIT (ligne 26.6 de la feuille de route).
--
-- Rapprochée d'un prélèvement, une échéance s'écrit face à la banque depuis le 01/10/2026 (`rapprocher_cotisation`).
-- Payée de la poche de l'exploitant, elle n'avait ni mouvement ni écriture : la 2035 la comptait à son échéance, le FEC
-- nulle part, et la concordance la disait en écart — son exercice ne pouvait pas être validé, sans geste pour le lever.
--
-- CE QUE LE DIRIGEANT PAIE DE SA POCHE POUR SON ACTIVITÉ EST UN APPORT, comme une note de frais : l'échéance s'écrit
-- face au compte du dirigeant au lieu de la banque — le 108000 de l'exploitant en trésorerie, le compte choisi pour le
-- dirigeant en engagement (455, 108 ou 467), celui de ses notes de frais et de ses virements personnels. La ventilation
-- est celle d'une échéance rapprochée : la cotisation au 646000 ; en trésorerie, sa CSG-CRDS au 108000. Mais en
-- trésorerie le compte du dirigeant EST le 108000 : la CSG-CRDS qu'il prend au débit et l'apport qu'il reçoit au crédit
-- se compensent sur le même compte, et l'écriture garde leur solde — la cotisation hors CSG-CRDS au 646000, face au
-- 108000, pour le même montant. En engagement, toute l'échéance va au 646000. Une échéance faite toute de CSG-CRDS ne
-- laisse rien à écrire en trésorerie. L'écriture est datée du paiement, une date que le cabinet connaît et qu'il
-- saisit — jamais proposée —, et la 2035 compte l'échéance ce jour-là (CGI, art. 93 : les dépenses PAYÉES).
--
-- UNE ÉCHÉANCE SE PAIE PAR UN MOUVEMENT OU PAR LE COMPTE PERSONNEL, JAMAIS LES DEUX : la fonction le refuse, et deux
-- déclencheurs le tiennent sans elle, sous le verrou de la ligne de l'échéance — l'un sur l'échéance, l'autre sur le
-- mouvement qu'on voudrait lui rapprocher.
--
-- LE PAIEMENT ET SON ÉCRITURE PARTENT ENSEMBLE, par `enregistrer_paiement_personnel_cotisation` (SECURITY DEFINER : elle
-- contrôle l'accès d'abord, sur le dossier annoncé, refait le calcul en centimes entiers, compare l'écriture composée
-- par l'application — lib/cotisationPersonnelle.ts — et l'écrit avec le paiement). Ni la date ni l'écriture ne se
-- posent autrement : les déclencheurs ne laissent passer que la fonction (le réglage `jd.paiement_personnel` de la
-- transaction, sur l'échéance qu'elle écrit) et la restauration d'une sauvegarde (le super-administrateur, dans un
-- dossier qui n'a encore aucun exercice validé — la porte de `garder_ecritures_validees`). Une échéance payée ne change
-- plus de montant ni de dossier tant que son paiement n'est pas retiré : l'écriture a été faite de ces montants, dans ce
-- dossier.
--
-- LE RETRAIT d'un paiement, avant la validation de son exercice, n'est pas dans cette migration : il supprime
-- l'écriture, et une suppression dans le corps d'une fonction se colle par le cabinet (CLAUDE.md). Supprimer
-- l'échéance (`supprimer_echeance_cotisation`) emporte déjà son paiement et son écriture : la clé est en cascade.
--
-- LA VALIDATION FIGE AUSSI LE PAIEMENT : une échéance compte à la date du mouvement qui la paie, sinon à celle de son
-- paiement personnel, sinon à son échéance — c'est cette date qui dit si elle appartient à un exercice validé
-- (`garder_cotisation_valide`, qui compare la ligne entière, nouvelle colonne comprise).
--
-- Données mesurées le 09/10/2026 (comptes seulement) : 43 échéances, toutes dans un bac à sable abandonné, dont 14
-- rapprochées ; aucune sur le dossier `test` ; aucun exercice validé. Tout ce qui suit est latent.

alter table public.cotisations_declarees add column paiement_personnel_le date;

comment on column public.cotisations_declarees.paiement_personnel_le is
  'Payée depuis le compte personnel de l''exploitant, ce jour-là : un apport, écrit face au compte du dirigeant par '
  '`enregistrer_paiement_personnel_cotisation`, seule à la poser. Nulle sinon. Jamais avec un mouvement qui la paie.';

alter table public.ecritures_brouillon add column cotisation_id uuid
  references public.cotisations_declarees (id) on delete cascade;

comment on column public.ecritures_brouillon.cotisation_id is
  'L''échéance de cotisation payée depuis le compte personnel dont cette ligne est l''écriture, datée du paiement. '
  'Nulle sur toute autre écriture : une échéance rapprochée s''écrit par son mouvement (`ligne_bancaire_id`).';

create index ecritures_brouillon_cotisation_id_idx on public.ecritures_brouillon (cotisation_id);

-- L'écriture d'un paiement personnel n'a ni pièce, ni mouvement, ni bien, ni véhicule, ni déclaration de TVA : le
-- paiement est sa seule source.
alter table public.ecritures_brouillon add constraint ecritures_brouillon_cotisation_sans_autre_source
  check (cotisation_id is null or (piece_id is null and ligne_bancaire_id is null and immobilisation_id is null
                                   and vehicule_id is null and declaration_tva_id is null));

-- ══ L'échéance : la date du paiement ne se pose que par la fonction, jamais sur une échéance rapprochée ══════════
create function public.garder_paiement_personnel() returns trigger
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

create trigger cotisations_declarees_paiement_personnel
  before insert or update on public.cotisations_declarees
  for each row execute function public.garder_paiement_personnel();

-- ══ Le mouvement : il ne paie pas une échéance payée depuis le compte personnel ══════════
-- Sous le verrou PARTAGÉ de la ligne de l'échéance : la fonction la prend en exclusif avant de regarder si un
-- mouvement la paie, donc l'un des deux attend l'autre et voit ce qu'il a écrit.
create function public.garder_mouvement_paiement_personnel() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paiement date;
begin
  if tg_op = 'UPDATE' and new.cotisation_id is not distinct from old.cotisation_id then
    return new;
  end if;
  select c.paiement_personnel_le into v_paiement from public.cotisations_declarees c
   where c.id = new.cotisation_id for share;
  if v_paiement is not null then
    raise exception 'Cette échéance est payée depuis le compte personnel, le % : un mouvement ne la paie pas aussi.',
      to_char(v_paiement, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lignes_bancaires_paiement_personnel
  before insert or update of cotisation_id on public.lignes_bancaires
  for each row when (new.cotisation_id is not null)
  execute function public.garder_mouvement_paiement_personnel();

-- ══ L'écriture : elle ne s'écrit, ne se modifie ni ne se retire qu'avec son paiement ══════════
-- Écrite par la fonction ou rendue par la restauration, au jour du paiement et dans le dossier de l'échéance ;
-- jamais modifiée ensuite (la validation ne pose que ses colonnes à elle, que ce déclencheur ne regarde pas) ; retirée
-- par la cascade d'une échéance ou d'un dossier supprimés, ou par la fonction qui retire le paiement.
create function public.garder_ecriture_paiement_personnel() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.cotisation_id is null
       or not exists (select 1 from public.dossiers where id = old.dossier_id)
       or not exists (select 1 from public.cotisations_declarees where id = old.cotisation_id)
       or coalesce(current_setting('jd.paiement_personnel', true), '') = old.cotisation_id::text then
      return old;
    end if;
    raise exception 'L''écriture d''un paiement depuis le compte personnel se retire avec ce paiement.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.cotisation_id is not null then
    raise exception 'L''écriture d''un paiement depuis le compte personnel ne se modifie pas : retire le paiement, puis déclare-le de nouveau.'
      using errcode = '42501';
  end if;
  if new.cotisation_id is null then
    return new;
  end if;
  if coalesce(current_setting('jd.paiement_personnel', true), '') is distinct from new.cotisation_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()
              and not exists (select 1 from public.exercices_valides v where v.dossier_id = new.dossier_id)) then
    raise exception 'L''écriture d''un paiement depuis le compte personnel ne s''écrit qu''avec ce paiement, par l''application.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.cotisations_declarees c
                  where c.id = new.cotisation_id and c.dossier_id = new.dossier_id
                    and c.paiement_personnel_le = new.date) then
    raise exception 'Cette écriture ne suit pas le paiement depuis le compte personnel de son échéance.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger ecritures_brouillon_paiement_personnel
  before insert or update of cotisation_id, dossier_id, date, compte, sens, montant, libelle or delete on public.ecritures_brouillon
  for each row execute function public.garder_ecriture_paiement_personnel();

-- ══ La validation fige l'échéance à la date de son paiement personnel ══════════
-- Une échéance compte à la date du mouvement qui la paie, sinon à celle de son paiement personnel, sinon à son
-- échéance (lib/cotisationRapprochee.ts, `cotisationsComptees`) : c'est cette date qui dit si elle appartient à un
-- exercice validé. Retirer le paiement d'une échéance dont l'échéance est figée la ferait compter dans cet exercice :
-- la base le refuse (« une échéance ne s'y ajoute plus »).
create or replace function public.garder_cotisation_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_date date;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    v_date := coalesce((select l.date from public.lignes_bancaires l where l.cotisation_id = old.id),
                       old.paiement_personnel_le, old.echeance);
    if v_frontiere is not null and v_date <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception '% : cette échéance ne se supprime plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception '% : cette échéance ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and coalesce(new.paiement_personnel_le, new.echeance) <= v_frontiere
     and not exists (select 1 from public.lignes_bancaires l where l.cotisation_id = new.id) then
    raise exception '% : une échéance ne s''y ajoute plus.',
      public.exercice_fige(new.dossier_id, extract(year from coalesce(new.paiement_personnel_le, new.echeance))::integer)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ══ Déclarer qu'une échéance a été payée depuis le compte personnel, et l'écrire ══════════
-- Seize refus, dans l'ordre que lib/cotisationPersonnelle.ts (`refusPaiementPersonnel`) reprend sous les mêmes mots :
-- l'accès au dossier annoncé, avant de rien lire ; l'échéance dans ce dossier, sous verrou ; ni déjà payée depuis le
-- compte personnel, ni rapprochée d'un mouvement ; pas figée par la validation ; la date (renseignée, pas avant 2000,
-- pas dans l'avenir à Paris, pas dans un exercice figé, pas avant l'ouverture d'un dossier repris) ; les montants (pas
-- nuls, au centime, la CSG-CRDS au centime et pas au-delà de l'échéance) ; l'écriture (lisible, puis celle qu'on
-- attend, comparée en centimes entiers et en multiensemble). Les codes par famille : 42501 l'accès, P0002
-- l'introuvable, 23514 ce que la validation fige, 22023 le reste.
create function public.enregistrer_paiement_personnel_cotisation(
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
  -- personnel (`classer_virement_personnel`).
  select d.mode_comptable, case when d.mode_comptable = 'engagement' then d.compte_notes_de_frais else '108000' end
    into v_mode, v_compte from public.dossiers d where d.id = p_dossier_id;
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

  -- L'écriture attendue, EN CENTIMES ENTIERS : la cotisation hors CSG-CRDS au 646000, face au compte du dirigeant ; dans
  -- le sens de l'échéance — un appel débite le 646000, un remboursement le crédite. Comparée en MULTIENSEMBLE : autant de
  -- lignes, et chacune des attendues présente, à l'égalité exacte — un montant reçu qui n'est pas au centime n'égale
  -- aucun nombre entier de centimes. Une ligne à zéro n'en est pas une.
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
      ('646000', v_sens_charge, v_net),
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
  'Déclare qu''une échéance de cotisation a été payée depuis le compte personnel de l''exploitant, à la date donnée, ET '
  'écrit son écriture (646000 la cotisation hors CSG-CRDS en trésorerie, face au compte du dirigeant), dans une '
  'transaction. Ne remplace rien : un paiement déjà déclaré se retire d''abord.';

revoke execute on function public.garder_paiement_personnel() from public, anon, authenticated;
revoke execute on function public.garder_mouvement_paiement_personnel() from public, anon, authenticated;
revoke execute on function public.garder_ecriture_paiement_personnel() from public, anon, authenticated;
revoke execute on function public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb) to authenticated;
