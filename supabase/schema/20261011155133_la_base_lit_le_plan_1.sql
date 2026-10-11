-- LA BASE LIT LE PLAN, SANS RIEN CHANGER — ligne 43, étape PC2, migration 1 sur 6 (conception : HISTORIQUE.md,
-- « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION », §2.3, §3.5, §3.6 ; le plan, `compte_du_role` et
-- `compte_du_dirigeant` : étape PC1).
--
-- Les quatorze fonctions qui nommaient un compte de rôle en dur (512000, 445710, 108000…) le lisent dans le plan du
-- dossier (`compte_du_role` : sa ligne, sinon le défaut du catalogue ; `compte_du_dirigeant` au lieu du `case` que cinq
-- recopiaient). Celles qui écrivent prennent d'abord le verrou PARTAGÉ du dossier, à la clé de `cle_validation` écrite
-- en ligne (l'appelant n'exécute pas cette fonction) : un changement du plan (étape PC4) ne les croisera pas. Les deux
-- lectrices, `liquidation_attendue` et `soldes_a_reporter`, se lisent sous le verrou de leur appelante.
--
-- ÉTAPE NEUTRE : aucune ligne n'est au plan (chaque migration s'arrête sinon) ; chaque rôle se lit à son défaut, et
-- chaque fonction rend, refuse et écrit exactement ce qu'elle faisait. Le reste de chaque corps est inchangé au
-- caractère près ; les commentaires nomment le rôle et son défaut.
--
-- Six migrations, chacune vérifiant que la précédente est en base : celle-ci par l'outil (aucune de ses fonctions
-- ne retire de ligne) ; les autres collées par le cabinet, avec leur ligne d'historique (leurs corps retirent
-- l'ancienne écriture avant d'écrire la nouvelle : CLAUDE.md, « Quand `apply_migration` attend une confirmation »).

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
  -- Chaque corps remplacé est celui sur lequel cette migration a été écrite (fins de ligne ramenées à \n).
  for f in select * from (values
    ('enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)', '8a344aa221a9ff2f6c20d2fb17f60e1d', '413e4db0288b1507644f381f934ccf6a'),
    ('lettrer_pieces(uuid, text, uuid[])', '55471428a76a66885ade8c26ac284c1a', '5ce7f42bd97dc1d0f86d055d95f3f63b'),
    ('soldes_a_reporter(uuid, integer)', '6e16f1600ad21ffc805591e32f99795c', '25b9a225872874ef24d6044cfa097483')
  ) as v(fonction, avant, apres) loop
    select md5(replace(p.prosrc, E'\r\n', E'\n')) into v_corps
      from pg_proc p where p.oid = to_regprocedure('public.' || f.fonction);
    if v_corps = f.avant then v_avant := v_avant + 1;
    elsif v_corps = f.apres then v_apres := v_apres + 1;
    else v_autres := concat_ws(', ', v_autres, f.fonction);
    end if;
  end loop;
  if v_apres = 3 then
    raise exception 'La migration la_base_lit_le_plan_1 est déjà en base : rien à faire.';
  end if;
  if v_avant <> 3 then
    raise exception 'Une fonction n''est plus celle sur laquelle cette migration a été écrite (%) : rien n''est remplacé.',
      coalesce(v_autres, 'en partie déjà remplacée');
  end if;
end
$garde$;

-- ══ enregistrer_paiement_personnel_cotisation ══
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

-- ══ lettrer_pieces ══
create or replace function public.lettrer_pieces(
  p_dossier_id uuid,
  p_compte text,
  p_pieces uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_mode text;
  v_groupe uuid := gen_random_uuid();
  v_piece uuid;
  v_nb integer;
  v_solde bigint;
  v_total bigint := 0;
begin
  if p_dossier_id is null or not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select mode_comptable into v_mode from public.dossiers where id = p_dossier_id;
  if v_mode is distinct from 'engagement' then
    raise exception 'Le lettrage ne se fait que dans un dossier tenu en engagement.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || p_dossier_id::text, 0));
  if p_compte is null or p_compte not in (public.compte_du_role(p_dossier_id, 'fournisseurs'),
                                          public.compte_du_role(p_dossier_id, 'fournisseurs_immobilisations'),
                                          public.compte_du_role(p_dossier_id, 'clients'),
                                          public.compte_du_role(p_dossier_id, 'associe'),
                                          public.compte_du_role(p_dossier_id, 'autres_debiteurs_crediteurs')) then
    raise exception 'Ce compte n''est pas un compte de tiers qui se lettre.' using errcode = '22023';
  end if;
  if p_pieces is null or cardinality(p_pieces) < 2 or array_position(p_pieces, null) is not null then
    raise exception 'Un lettrage fait à la main apparie au moins deux pièces.' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_pieces) as x) <> cardinality(p_pieces) then
    raise exception 'Une pièce est choisie deux fois.' using errcode = '22023';
  end if;

  foreach v_piece in array p_pieces loop
    if not exists (select 1 from public.pieces where id = v_piece and dossier_id = p_dossier_id) then
      raise exception 'Une des pièces n''appartient pas à ce dossier.' using errcode = '22023';
    end if;
    if exists (select 1 from public.lettrages_manuels where piece_id = v_piece) then
      raise exception 'Une des pièces est déjà lettrée à la main avec d''autres : défais d''abord ce lettrage.'
        using errcode = '22023';
    end if;
    -- En centimes : le montant n'est pas contraint au centime en base, et une somme de numériques arrondie à la fin
    -- ne dirait pas la même chose que l'application, qui arrondit chaque ligne.
    select count(*), coalesce(sum(case when sens = 'debit' then 1 else -1 end * round(montant * 100)), 0)::bigint
      into v_nb, v_solde
      from public.ecritures_brouillon
     where dossier_id = p_dossier_id and piece_id = v_piece and compte = p_compte;
    if v_nb = 0 then
      raise exception 'Une des pièces n''a aucune écriture sur ce compte : génère d''abord ses écritures.'
        using errcode = '22023';
    end if;
    if v_solde = 0 then
      raise exception 'Une des pièces est déjà soldée par ses règlements : elle se lettre seule.' using errcode = '22023';
    end if;
    v_total := v_total + v_solde;
  end loop;

  if v_total <> 0 then
    raise exception 'Ces pièces ne se soldent pas : il reste % € sur le compte.',
      replace(to_char(abs(v_total) / 100.0, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  insert into public.lettrages_manuels (dossier_id, groupe, piece_id, compte)
  select p_dossier_id, v_groupe, x, p_compte from unnest(p_pieces) as x;
  return v_groupe;
end;
$$;

-- ══ soldes_a_reporter ══
create or replace function public.soldes_a_reporter(p_dossier_id uuid, p_annee integer)
returns table (compte text, libelle text, sens text, montant numeric)
language sql stable set search_path = public as $$
  -- Le plan du dossier (ligne 43), lu sous le verrou EXCLUSIF de l'appelant (`valider_exercice`, seul à l'exécuter) :
  -- « individuel », un dossier en trésorerie ou dont le dirigeant est le compte du rôle `exploitant`.
  with modele as (
    select (d.mode_comptable = 'tresorerie'
            or d.compte_notes_de_frais = public.compte_du_role(d.id, 'exploitant')) as individuel,
           public.compte_du_role(d.id, 'capital_individuel') as capital,
           public.compte_du_role(d.id, 'resultat_benefice') as benefice,
           public.compte_du_role(d.id, 'resultat_perte') as perte
      from public.dossiers d where d.id = p_dossier_id
  ), mouvements as (
    select e.compte, e.compte_lib as lib, case when e.sens = 'debit' then e.montant else -e.montant end as net
      from public.ecritures_brouillon e
     where e.dossier_id = p_dossier_id and e.statut = 'validee'
       and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
    union all
    select a.compte, a.compte_lib, case when a.sens = 'debit' then a.montant else -a.montant end
      from public.a_nouveaux a
     where a.dossier_id = p_dossier_id and a.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
    union all
    select s.compte, s.compte_lib, case when s.sens = 'debit' then s.montant else -s.montant end
      from public.soldes_reportes s
     where s.dossier_id = p_dossier_id and s.date = make_date(p_annee, 1, 1)
  ), soldes as (
    select m.compte, max(m.lib) as lib, sum(m.net) as net from mouvements m group by m.compte
  ), resultat as (
    select coalesce(sum(s.net) filter (where s.compte ~ '^[67]'), 0) as net from soldes s
  ), cibles as (
    select s.compte, s.lib, s.net, md.individuel, r.net as resultat,
      case
        when s.compte ~ '^[67]' then
          case when md.individuel then md.capital when r.net < 0 then md.benefice else md.perte end
        when md.individuel and s.compte ~ '^(101|108|12)' then md.capital
        else s.compte
      end as cible
    from soldes s cross join modele md cross join resultat r
  )
  select c.cible,
    case
      when not c.individuel and c.resultat <> 0
           and c.cible = case when c.resultat < 0 then (select benefice from modele) else (select perte from modele) end then
        case when bool_or(c.compte !~ '^[67]' and c.net <> 0) then 'Résultats en attente d’affectation'
          else format('Résultat de l’exercice %s (%s), en attente d’affectation', p_annee,
            case when c.resultat < 0 then 'bénéfice' else 'perte' end)
        end
      else coalesce(max(c.lib) filter (where c.compte = c.cible),
                    case when c.cible = (select capital from modele) then 'Capital individuel' end)
    end,
    case when sum(c.net) > 0 then 'debit' else 'credit' end,
    abs(sum(c.net))
  from cibles c
  group by c.cible, c.individuel, c.resultat
  having sum(c.net) <> 0
$$;
