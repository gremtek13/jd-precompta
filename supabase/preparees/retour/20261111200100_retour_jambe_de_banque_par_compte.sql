-- RETOUR de la migration `jambe_de_banque_par_compte` (MCB5, 20261111200000) : les dix fonctions reprennent le corps
-- qu'elles ont en production le 11/11/2026 (leurs empreintes, celles de la garde de tête de l'aller), la jambe de banque
-- au compte du rôle `banque` du plan. Rien d'autre ne bouge. À jouer AVANT le retour de `comptes_bancaires` (MCB1), dont
-- elles appellent la fonction. Non destructif pour les données : les écritures déjà écrites restent ; un mouvement d'un
-- compte qui tient son propre 512, écrit pendant que l'aller était en base, ne se réécrirait plus que sur le 512 du rôle
-- (la fonction refuserait l'écriture d'hier) — à vérifier avant de jouer ce retour :
--   select count(*) from public.lignes_bancaires l where public.compte_de_banque_du_mouvement(l.id) <> public.compte_du_role(l.dossier_id, 'banque');
-- Le corps de sept fonctions nomme la suppression des lignes propres au mouvement, comme en production : à coller.

-- ══ 0. La garde de tête ══
do $garde$
declare
  v_nom text;
begin
  if to_regprocedure('public.compte_de_banque_du_mouvement(uuid)') is null
     or to_regclass('public.comptes_bancaires') is null then
    raise exception 'La migration comptes_bancaires (MCB1) n''est pas en base : ce retour la suit.';
  end if;
  select e.nom into v_nom
    from (values
      ('affecter_mouvement_bancaire', 'a93c61442be323d5c27540a1bfa3a93b'),
      ('classer_virement_personnel', '8696c3c1152930961f72c6918a161c2c'),
      ('ecrire_mouvement_compte_bilan', '419d86fdfdcd16c5c3a8c94487bcffc5'),
      ('ecriture_attendue_vente_facturee', 'efc86373a9fc5a6f584fffe589c1f676'),
      ('ecritures_attendues_de_la_periode', '792376765eb4b1a829b3356f78bed910'),
      ('rapprocher_cotisation', '2559833009639c117795ad40d74dc31f'),
      ('rapprocher_declaration_tva', 'f6f435ceecf23a34c6871f2802d23524'),
      ('rapprocher_echeance_emprunt', 'cbfcc71ca4dd07935323ec437d40f6a2'),
      ('refus_compte_de_contrepartie', '2b3f38b3bf882b38e1d4aeac250117a4'),
      ('ventiler_mouvement_bancaire', '0fd0734677f8c2b087be43e939e5b9af')) e(nom, empreinte)
   where not exists (select 1 from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname = e.nom
                        and md5(replace(p.prosrc, E'\r\n', E'\n')) = e.empreinte)
   limit 1;
  if v_nom is not null then
    raise exception 'La fonction % n''est plus celle que ce retour remplace : la relire avant de l''appliquer.', v_nom;
  end if;
end
$garde$;

-- ══ 1. affecter_mouvement_bancaire ══
create or replace function public.affecter_mouvement_bancaire(p_ligne_bancaire_id uuid, p_categorie_id uuid, p_ecritures jsonb, p_taux_tva numeric DEFAULT NULL::numeric)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_categorie public.categories%rowtype;
  v_assujetti boolean;
  v_avec_taux boolean;
  v_tva numeric := 0;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
  v_banque text;
  v_tva_collectee text;
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
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
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

  -- Le taux : exigé pour une recette d'un dossier assujetti, refusé partout ailleurs.
  select assujetti_tva into v_assujetti from public.dossiers where id = v_ligne.dossier_id;
  v_avec_taux := v_assujetti and v_categorie.compte_comptable ~ '^7';
  if v_avec_taux and p_taux_tva is null then
    raise exception 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
      using errcode = '22023';
  end if;
  if not v_avec_taux and p_taux_tva is not null then
    raise exception 'Un taux de TVA ne s''applique qu''à une recette d''un dossier assujetti.' using errcode = '22023';
  end if;
  if p_taux_tva is not null and p_taux_tva not in (0, 5.5, 8.5, 10, 20) then
    raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, la catégorie au hors taxe
  -- dans le sens inverse, et la TVA collectée à côté d'elle quand le taux en porte. Comparée en
  -- MULTIENSEMBLE, comme celle d'une ventilation : autant de lignes, et chacune des attendues présente.
  if p_taux_tva is not null then
    v_tva := public.tva_incluse(v_ligne.montant, p_taux_tva);
  end if;
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_tva_collectee := public.compte_du_role(v_ligne.dossier_id, 'tva_collectee');
  with attendues as (
    select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select v_categorie.compte_comptable, v_sens_compte, abs(v_ligne.montant) - v_tva
    union all
    select v_tva_collectee, v_sens_compte, v_tva where v_tva > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set categorie_id = p_categorie_id, taux_tva = p_taux_tva, statut = 'rapprochee'
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
$function$
;

-- ══ 2. classer_virement_personnel ══
create or replace function public.classer_virement_personnel(p_ligne_bancaire_id uuid, p_ecritures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
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
$function$
;

-- ══ 3. ecrire_mouvement_compte_bilan ══
create or replace function public.ecrire_mouvement_compte_bilan(p_ligne_bancaire_id uuid, p_compte text, p_ecritures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_mode text;
  v_dirigeant text;
  v_banque text;
  v_caisse text;
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
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  -- La caisse du dossier, lue dans son plan comme la banque (ligne 26.6, étape C1b) : le seul compte 53 sur lequel un
  -- mouvement s'écrive.
  v_caisse := public.compte_du_role(v_ligne.dossier_id, 'caisse');
  -- Le compte du dirigeant se lit dans le dossier, comme pour un virement personnel : celui du rôle `exploitant`
  -- en trésorerie (108000 par défaut), le compte choisi pour lui en engagement.
  select mode_comptable, public.compte_du_dirigeant(id)
    into v_mode, v_dirigeant from public.dossiers where id = v_ligne.dossier_id;
  -- Le compte de la caisse du plan, en trésorerie, se reçoit : le versement d'espèces en banque, ou des espèces
  -- retirées pour la caisse. Tout autre compte — et celui de la caisse en engagement, où elle attend sa conception — se
  -- juge comme hier.
  if v_mode = 'tresorerie' and p_compte = v_caisse then
    v_refus := null;
  else
    v_refus := public.refus_compte_de_bilan(p_compte, v_mode, v_dirigeant);
  end if;
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
$function$
;

-- ══ 4. ecriture_attendue_vente_facturee ══
create or replace function public.ecriture_attendue_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid, OUT motif text, OUT detail text, OUT lignes text[])
 RETURNS record
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_mode text;
  v_banque text;
  v_clients text;
  v_collectee text;
  v_attente text;
  v_valeurs text;
  v_caisse text;
  v_frais_bancaires text;
  v_produit text;
  v_facture_id uuid;
  v_document public.factures_emises;
  v_e public.encaissements_factures;
  v_t public.encaissements_factures;
  v_m public.lignes_bancaires;
  v_calcul jsonb;
  v_x record;
  v_compte text;
  v_ligne uuid;
  v_montant bigint;
  v_total bigint;
  v_meme_jour bigint;
  v_frais bigint;
  v_soldes jsonb := '[]';
begin
  lignes := '{}';
  select d.mode_comptable into v_mode from public.dossiers d where d.id = p_dossier_id;
  v_banque := public.compte_du_role(p_dossier_id, 'banque');
  v_clients := public.compte_du_role(p_dossier_id, 'clients');
  v_collectee := public.compte_du_role(p_dossier_id, 'tva_collectee');
  v_attente := public.compte_du_role(p_dossier_id, 'tva_collectee_en_attente');
  v_valeurs := public.compte_du_role(p_dossier_id, 'valeurs_a_l_encaissement');
  v_caisse := public.compte_du_role(p_dossier_id, 'caisse');
  v_frais_bancaires := public.compte_du_role(p_dossier_id, 'services_bancaires');

  if p_source = 'mouvement' then
    select l.* into v_m from public.lignes_bancaires l where l.id = p_source_id and l.dossier_id = p_dossier_id;
    -- Ce qu'il justifie : les encaissements non retirés qui le citent, qu'aucune contre-passation sans mouvement n'annule.
    -- Une facture reprise de l'ancien logiciel (A8b) compte sa vente comme une facture validée source.
    if not exists (select 1 from public.encaissements_factures e
                     join public.factures_emises f on f.id = e.facture_id
                    where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
                      and f.statut in ('validee', 'importee') and f.source_de_la_vente
                      and public.encaissement_justifie_son_mouvement(e.id)) then
      return;
    end if;
    -- Le virement mixte (VF2-Q2, selon VF5-Q2 : la manière A) : l'encaissement d'une facture qui n'est pas source de sa
    -- vente ne retient plus le mouvement quand cette facture a exactement un exemplaire désigné, une pièce de vente
    -- validée de ce dossier (VF1) — c'est cette pièce qui compte la vente, et qui écrit elle-même sa banque sur ce
    -- mouvement, à sa date (src/lib/contrepartieBanque.ts). Sans lui, ou avec plusieurs, le refus d'hier, la facture
    -- nommée : celle qui a le plus petit numéro, comme le classement la nomme.
    select f.numero into detail
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
       and not (f.statut in ('validee', 'importee') and f.source_de_la_vente) and public.encaissement_justifie_son_mouvement(e.id)
       and (select count(*) from public.pieces p
             where p.facture_id = f.id and p.dossier_id = p_dossier_id and p.statut = 'validee' and p.type_piece = 'vente') <> 1
     order by f.numero collate "C", f.id
     limit 1;
    if found then
      motif := 'mouvement_facture_non_source';
      return;
    end if;
    if exists (select 1 from public.encaissements_factures e
                where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
                  and public.encaissement_justifie_son_mouvement(e.id)
                  and exists (select 1 from public.calcul_vente_facturee(e.facture_id) c where c.genre = 'ecartee')) then
      motif := 'mouvement_vente_ecartee';
      return;
    end if;
    v_montant := (v_m.montant * 100)::bigint;
    select coalesce(sum((e.montant * 100)::bigint), 0),
           coalesce(sum((e.montant * 100)::bigint) filter (where e.date_encaissement = v_m.date or not f.source_de_la_vente), 0)
      into v_total, v_meme_jour
      from public.encaissements_factures e
      join public.factures_emises f on f.id = e.facture_id
     where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
       and public.encaissement_justifie_son_mouvement(e.id);
    -- Ceux du même jour ont porté la banque eux-mêmes ; ceux d'un autre jour sont passés au 511 (au 53 pour des
    -- espèces), que le mouvement solde. La pièce d'une facture qui n'est pas source porte elle-même sa banque sur ce
    -- mouvement, quel que soit le jour de son encaissement : comme un encaissement du même jour. Les frais sont ceux
    -- du tout.
    v_soldes := coalesce((
      select jsonb_agg(jsonb_build_object('d', v_m.date, 'c', case when e.moyen = 'especes' then v_caisse else v_valeurs end,
                                          'l', v_m.id, 'm', -((e.montant * 100)::bigint)))
        from public.encaissements_factures e
        join public.factures_emises f on f.id = e.facture_id
       where e.ligne_bancaire_id = p_source_id and e.dossier_id = p_dossier_id and e.retire_le is null
         and public.encaissement_justifie_son_mouvement(e.id) and e.date_encaissement <> v_m.date
         and f.source_de_la_vente), '[]');
    v_frais := v_total - v_montant;
    v_soldes := v_soldes || jsonb_build_array(
      jsonb_build_object('d', v_m.date, 'c', v_banque, 'l', v_m.id, 'm', v_montant - v_meme_jour),
      jsonb_build_object('d', v_m.date, 'c', v_frais_bancaires, 'l', v_m.id, 'm', v_frais));
  else
    -- Une facture, un avoir ou un encaissement : la facture dont il dépend.
    if p_source = 'encaissement' then
      select e.* into v_e from public.encaissements_factures e where e.id = p_source_id and e.dossier_id = p_dossier_id;
      v_facture_id := v_e.facture_id;
    else
      select f.* into v_document from public.factures_emises f where f.id = p_source_id and f.dossier_id = p_dossier_id;
      v_facture_id := case when v_document.type = 'avoir' then v_document.facture_origine_id else v_document.id end;
    end if;
    v_calcul := coalesce((select jsonb_agg(to_jsonb(c)) from public.calcul_vente_facturee(v_facture_id) c), '[]');
    if exists (select 1 from jsonb_array_elements(v_calcul) x where x ->> 'genre' = 'ecartee') then
      motif := 'vente_ecartee';
      detail := (select x ->> 'motif' from jsonb_array_elements(v_calcul) x where x ->> 'genre' = 'ecartee');
      return;
    end if;
    select case when f.nature_operation = 'biens' then public.compte_du_role(p_dossier_id, 'ventes_de_biens')
                else public.compte_du_role(p_dossier_id, 'prestations_de_services') end
      into v_produit from public.factures_emises f where f.id = v_facture_id;

    if p_source = 'encaissement' then
      if not exists (select 1 from jsonb_array_elements(v_calcul) x
                      where x ->> 'genre' = 'part' and x ->> 'encaissement_id' = p_source_id::text) then
        return;
      end if;
      -- [T] : une contre-passation sans mouvement défait son encaissement là où il a été écrit.
      v_t := v_e;
      if v_e.annule_id is not null and v_e.ligne_bancaire_id is null then
        select o.* into v_t from public.encaissements_factures o where o.id = v_e.annule_id;
      end if;
      if v_t.ligne_bancaire_id is not null then
        select l.* into v_m from public.lignes_bancaires l where l.id = v_t.ligne_bancaire_id;
        if v_m.date = v_t.date_encaissement then
          v_compte := v_banque;
          v_ligne := v_m.id;
        else
          v_compte := case when v_t.moyen = 'especes' then v_caisse else v_valeurs end;
        end if;
      elsif v_t.moyen = 'especes' then
        v_compte := v_caisse;
      elsif v_t.moyen in ('compensation', 'autre') then
        if v_t.compte_contrepartie is null then
          motif := 'compte_a_choisir';
          return;
        end if;
        if public.refus_compte_de_contrepartie(p_dossier_id, v_t.compte_contrepartie) is not null then
          motif := 'compte_refuse';
          detail := v_t.compte_contrepartie;
          return;
        end if;
        v_compte := v_t.compte_contrepartie;
      else
        v_compte := v_valeurs;
      end if;
      for v_x in select (x ->> 'taux')::numeric as part_taux, (x ->> 'ttc_centimes')::bigint as ttc,
                        (x ->> 'base_centimes')::bigint as ht, (x ->> 'tva_centimes')::bigint as tva,
                        exists (select 1 from jsonb_array_elements(v_calcul) y
                                 where y ->> 'genre' = 'exigibilite' and y ->> 'origine' = 'encaissement'
                                   and y ->> 'encaissement_id' = p_source_id::text
                                   and (y ->> 'taux')::numeric = (x ->> 'taux')::numeric) as exigible
                   from jsonb_array_elements(v_calcul) x
                  where x ->> 'genre' = 'part' and x ->> 'encaissement_id' = p_source_id::text loop
        v_soldes := v_soldes || jsonb_build_array(
          jsonb_build_object('d', v_e.date_encaissement, 'c', v_compte, 'l', v_ligne, 'm', v_x.ttc));
        if v_mode = 'tresorerie' then
          v_soldes := v_soldes || jsonb_build_array(
            jsonb_build_object('d', v_e.date_encaissement, 'c', v_produit, 'l', null, 'm', -v_x.ht),
            jsonb_build_object('d', v_e.date_encaissement, 'c', case when v_x.exigible then v_collectee else v_clients end,
                               'l', null, 'm', -v_x.tva));
        else
          v_soldes := v_soldes || jsonb_build_array(
            jsonb_build_object('d', v_e.date_encaissement, 'c', v_clients, 'l', null, 'm', -v_x.ttc));
          if v_x.exigible then
            v_soldes := v_soldes || jsonb_build_array(
              jsonb_build_object('d', v_e.date_encaissement, 'c', v_attente, 'l', null, 'm', v_x.tva),
              jsonb_build_object('d', v_e.date_encaissement, 'c', v_collectee, 'l', null, 'm', -v_x.tva));
          end if;
        end if;
      end loop;
    else
      -- La facture, ou l'avoir : en engagement, le document à sa date ; dans les deux modèles, la TVA due avant
      -- l'encaissement — la livraison d'un bien, la facture sur les débits, l'avoir d'après — à sa date.
      if v_mode = 'engagement' then
        for v_x in select (x ->> 'date_effet')::date as jour, (x ->> 'ttc_centimes')::bigint as ttc,
                          (x ->> 'base_centimes')::bigint as base, (x ->> 'tva_centimes')::bigint as tva
                     from jsonb_array_elements(v_calcul) x
                    where x ->> 'genre' = 'document'
                      and coalesce(x ->> 'avoir_id', '') = case when p_source = 'avoir' then p_source_id::text else '' end loop
          v_soldes := v_soldes || jsonb_build_array(
            jsonb_build_object('d', v_x.jour, 'c', v_clients, 'l', null, 'm', v_x.ttc),
            jsonb_build_object('d', v_x.jour, 'c', v_produit, 'l', null, 'm', -v_x.base),
            jsonb_build_object('d', v_x.jour, 'c', v_attente, 'l', null, 'm', -v_x.tva));
        end loop;
      end if;
      for v_x in select (x ->> 'date_effet')::date as jour, (x ->> 'tva_centimes')::bigint as tva
                   from jsonb_array_elements(v_calcul) x
                  where x ->> 'genre' = 'exigibilite' and x ->> 'origine' <> 'encaissement'
                    and (p_source = 'facture' and x ->> 'origine' in ('livraison', 'facture')
                         or p_source = 'avoir' and x ->> 'avoir_id' = p_source_id::text) loop
        v_soldes := v_soldes || jsonb_build_array(
          jsonb_build_object('d', v_x.jour, 'c', case when v_mode = 'tresorerie' then v_clients else v_attente end,
                             'l', null, 'm', v_x.tva),
          jsonb_build_object('d', v_x.jour, 'c', v_collectee, 'l', null, 'm', -v_x.tva));
      end loop;
    end if;
  end if;

  -- Les lignes : sommées par date, compte et mouvement, les nulles ôtées.
  lignes := array(
    select t.texte
      from (select to_char(s.jour, 'YYYY-MM-DD') || '|' || s.compte || '|' || case when s.solde > 0 then 'debit' else 'credit' end
                   || '|' || abs(s.solde) || '|' || coalesce(s.ligne::text, '') as texte
              from (select (x ->> 'd')::date as jour, x ->> 'c' as compte, (x ->> 'l')::uuid as ligne,
                           sum((x ->> 'm')::bigint) as solde
                      from jsonb_array_elements(v_soldes) x
                     group by 1, 2, 3) s
             where s.solde <> 0) t
     order by t.texte collate "C");

  -- Le mouvement : rien à écrire quand tout est du même jour et sans écart ; sinon, classé, et à l'écart des frais près.
  if p_source = 'mouvement' and cardinality(lignes) > 0 then
    if not v_m.encaissements_de_factures then
      motif := 'mouvement_non_classe';
      lignes := '{}';
    elsif v_frais < 0 or v_frais * 100 > least(50000, abs(v_total) * 2) then
      motif := 'mouvement_ecart';
      lignes := '{}';
    end if;
  end if;
end
$function$
;

-- ══ 5. ecritures_attendues_de_la_periode ══
create or replace function public.ecritures_attendues_de_la_periode(p_dossier_id uuid, p_frontiere date, p_fin date)
 RETURNS TABLE(genre text, source_id uuid, date_source date, motif text, detail text, lignes text[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET jit TO 'off'
 SET enable_nestloop TO 'off'
AS $function$
begin
  -- Une requête planifiée à chaque appel sur les valeurs reçues ($1 le dossier, $2 la frontière, $3 la fin de la période),
  -- jointe par hachage : le planificateur estime mal ce que rendent ses étapes enchaînées, et des boucles imbriquées la
  -- rendraient quadratique (mesuré : 1,2 à 1,9 s au lieu de 0,25 à 0,4 s pour 3 000 encaissements). Et sans compilation à
  -- la volée (`jit`), que la production n'emploie pas et qui coûterait ici dix secondes de plus que la requête.
  return query execute $q$
with recursive
-- ── Le dossier : son modèle comptable et les comptes de ses rôles, lus une fois ──
dossier as (
  select d.mode_comptable as mode, public.compte_du_role(d.id, 'banque') as banque,
         public.compte_du_role(d.id, 'clients') as clients, public.compte_du_role(d.id, 'tva_collectee') as collectee,
         public.compte_du_role(d.id, 'tva_collectee_en_attente') as attente,
         public.compte_du_role(d.id, 'valeurs_a_l_encaissement') as valeurs, public.compte_du_role(d.id, 'caisse') as caisse,
         public.compte_du_role(d.id, 'services_bancaires') as frais_bancaires,
         public.compte_du_role(d.id, 'ventes_de_biens') as ventes_de_biens,
         public.compte_du_role(d.id, 'prestations_de_services') as prestations
    from public.dossiers d
   where d.id = $1
),
-- ── LES SOURCES DE LA PÉRIODE ──
-- Celles dont une date y tombe — l'émission d'une facture ou d'un avoir source, la livraison d'une facture, un
-- encaissement d'une facture source, un mouvement que l'un d'eux cite, classé par ses encaissements ou libre —, et celles
-- dont le brouillon y propose une ligne. Une source n'écrit qu'à ses dates : une autre n'a, dans la période, ni rien à
-- écrire ni rien de proposé. Sans frontière, la période part du début des temps.
candidates as (
  select case when f.type = 'avoir' then 'avoir' else 'facture' end as genre, f.id, f.date_emission as date_source,
         coalesce(f.facture_origine_id, f.id) as facture_id
    from public.factures_emises f
   where f.dossier_id = $1 and f.statut = 'validee' and f.source_de_la_vente
     and (f.date_emission <= $3 and ($2 is null or f.date_emission > $2)
          or f.type = 'facture' and f.date_prestation <= $3 and ($2 is null or f.date_prestation > $2))
  union
  select 'encaissement', e.id, e.date_encaissement, e.facture_id
    from public.encaissements_factures e
    join public.factures_emises f on f.id = e.facture_id
   where e.dossier_id = $1 and f.source_de_la_vente
     and e.date_encaissement <= $3 and ($2 is null or e.date_encaissement > $2)
  union
  select 'mouvement', l.id, l.date, null::uuid
    from public.lignes_bancaires l
   where l.dossier_id = $1 and l.date <= $3 and ($2 is null or l.date > $2)
     and (l.encaissements_de_factures or public.mouvement_libre(l))
     and exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = l.id and e.dossier_id = $1 and f.source_de_la_vente)
  union
  select case when f.type = 'avoir' then 'avoir' else 'facture' end, f.id, f.date_emission,
         coalesce(f.facture_origine_id, f.id)
    from public.ecritures_brouillon b
    join public.factures_emises f on f.id = b.facture_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
  union
  select 'encaissement', e.id, e.date_encaissement, e.facture_id
    from public.ecritures_brouillon b
    join public.encaissements_factures e on e.id = b.encaissement_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
  union
  select 'mouvement', l.id, l.date, null::uuid
    from public.ecritures_brouillon b
    join public.lignes_bancaires l on l.id = b.ligne_bancaire_id
   where b.dossier_id = $1 and b.statut = 'proposee'
     and b.date <= $3 and ($2 is null or b.date > $2)
     and b.facture_id is null and b.encaissement_id is null and b.piece_id is null and b.immobilisation_id is null
     and b.vehicule_id is null and b.declaration_tva_id is null and b.cotisation_id is null
     and (l.encaissements_de_factures or public.mouvement_libre(l))
     and exists (select 1 from public.encaissements_factures e
                   join public.factures_emises f on f.id = e.facture_id
                  where e.ligne_bancaire_id = l.id and e.dossier_id = $1 and f.source_de_la_vente)
),
-- ══ LA RÈGLE DU CUMUL, POUR TOUTES CES FACTURES À LA FOIS : `calcul_vente_facturee`, redite d'un bloc ══
-- Les factures dont une source dépend, et celles dont un mouvement de la période porte un encaissement.
utiles as (
  select c.facture_id as id from candidates c where c.facture_id is not null
  union
  select e.facture_id
    from candidates c
    join public.encaissements_factures e on e.ligne_bancaire_id = c.id and e.dossier_id = $1
   where c.genre = 'mouvement'
),
-- Celles que la règle compte : des factures validées sources, chacune son régime, là où la base le fige ; et, depuis A8b,
-- des factures reprises de l'ancien logiciel (`reprise`), sources de leur vente par leur import.
fac as (
  select f.id, f.dossier_id, f.date_emission, f.date_prestation, f.nature_operation, f.statut = 'importee' as reprise,
         case when f.nature_operation = 'biens' then 'livraison'
              when f.nature_operation is distinct from 'services' then 'nature'
              when f.option_debits is null then 'option_debits'
              when f.option_debits then 'debits'
              else 'encaissement' end as regime
    from utiles u
    join public.factures_emises f on f.id = u.id
   where f.type = 'facture' and f.statut in ('validee', 'importee') and f.source_de_la_vente
),
-- Les montants par taux : ceux que le document transmet ; d'une facture reprise, ceux de la règle de TVA que ses montants
-- déclarés suivaient (`montants_par_taux_du_document`).
montants as (
  select x.id as facture_id, m.taux, m.base_centimes as base, m.tva_centimes as tva, m.ttc_centimes as ttc
    from fac x
    cross join lateral public.montants_par_taux_facture(x.id) m
   where not x.reprise
  union all
  select x.id, m.taux, m.base_centimes, m.tva_centimes, m.ttc_centimes
    from fac x
    cross join lateral public.montants_par_taux_du_document(x.id) m
   where x.reprise
),
-- Les avoirs validés sources ; et ceux d'une facture reprise que l'ancien logiciel a émis (`repris`), qui la citent dans
-- `factures_importees`, datés d'avant la reprise : ils diminuent V et T, sans document.
avoirs as (
  select x.id as facture_id, a.id as avoir_id, a.date_emission, false as repris, m.taux, m.base_centimes as base,
         m.tva_centimes as tva, m.ttc_centimes as ttc
    from fac x
    join public.factures_emises a on a.dossier_id = x.dossier_id and a.facture_origine_id = x.id and a.type = 'avoir'
                                 and a.statut = 'validee' and a.source_de_la_vente
    cross join lateral public.montants_par_taux_facture(a.id) m
  union all
  select x.id, a.id, a.date_emission, true, m.taux, m.base_centimes, m.tva_centimes, m.ttc_centimes
    from fac x
    join public.factures_importees ai on ai.origine_id = x.id
    join public.factures_emises a on a.id = ai.facture_id and a.dossier_id = x.dossier_id and a.type = 'avoir'
                                 and a.statut = 'importee'
    cross join lateral public.montants_par_taux_du_document(a.id) m
   where x.reprise
),
-- Les encaissements qui comptent (non retirés), dans leur ordre : leur date, leur création, leur identifiant.
encs as (
  select e.id, e.facture_id, e.annule_id, e.date_encaissement, e.moyen, e.ligne_bancaire_id,
         (e.montant * 100)::bigint as montant,
         row_number() over (partition by e.facture_id order by e.date_encaissement, e.cree_le, e.id) as rang
    from fac x
    join public.encaissements_factures e on e.dossier_id = x.dossier_id and e.facture_id = x.id and e.retire_le is null
),
parts as (
  select e.facture_id, e.id as encaissement_id, e.rang, e.annule_id, e.date_encaissement, t.taux,
         (t.montant * 100)::bigint as part
    from encs e
    join fac x on x.id = e.facture_id
    join public.encaissements_factures_taux t on t.encaissement_id = e.id and t.dossier_id = x.dossier_id
),
-- Un encaissement illisible : de montant nul, ou que ses parts ne font pas, au centime, sur des taux de la facture et
-- de son signe ; sans part, il est illisible.
lectures as (
  select e.facture_id,
         coalesce(e.montant = 0 or coalesce(sum(p.part), 0) <> e.montant
                  or bool_or(sign(p.part) <> sign(e.montant) or m.facture_id is null), true) as illisible
    from encs e
    left join parts p on p.encaissement_id = e.id
    left join montants m on m.facture_id = p.facture_id and m.taux = p.taux
   group by e.facture_id, e.id, e.montant
),
-- La facture écartée avant la règle : sa nature, son option, ses lignes, un encaissement illisible.
avec_lignes as (
  select distinct m.facture_id from montants m
),
illisibles as (
  select distinct l.facture_id from lectures l where l.illisible
),
avant_le_cumul as (
  select x.id,
         case when x.regime in ('nature', 'option_debits') then x.regime
              when a.facture_id is null then 'sans_lignes'
              when i.facture_id is not null then 'encaissement_illisible'
         end as motif
    from fac x
    left join avec_lignes a on a.facture_id = x.id
    left join illisibles i on i.facture_id = x.id
),
-- V et T de chaque part d'un encaissement — pas d'une contre-passation : la TVA et le TTC de son taux, nets des avoirs
-- datés au plus tard du jour de l'encaissement.
vt as (
  select p.encaissement_id, p.taux, p.facture_id, p.rang,
         coalesce(max(m.tva), 0) - coalesce(sum(a.tva), 0) as v,
         coalesce(max(m.base + m.tva), 0) - coalesce(sum(a.base + a.tva), 0) as t
    from parts p
    join avant_le_cumul c on c.id = p.facture_id and c.motif is null
    left join montants m on m.facture_id = p.facture_id and m.taux = p.taux
    left join avoirs a on a.facture_id = p.facture_id and a.taux = p.taux and a.date_emission <= p.date_encaissement
   where p.annule_id is null
   group by p.encaissement_id, p.taux, p.facture_id, p.rang
),
-- A8b (A8-Q6) : le départ du cumul d'une facture reprise, taux par taux — ce qui en était encaissé avant la reprise, et la
-- TVA que la règle lui rend sur V et T nets de ses avoirs repris, tous datés d'avant la reprise : celle que l'ancien
-- logiciel a portée. Un taux que ses avoirs repris annulent n'a plus de TTC à répartir.
departs as (
  select d.facture_id, d.taux, d.encaisse,
         coalesce(max(m.tva), 0) - coalesce(sum(a.tva), 0) as v,
         coalesce(max(m.base + m.tva), 0) - coalesce(sum(a.base + a.tva), 0) as t
    from (select x.id as facture_id, (g.valeur ->> 'taux')::numeric as taux,
                 ((g.valeur ->> 'encaisse')::numeric * 100)::bigint as encaisse
            from fac x
            join avant_le_cumul c on c.id = x.id and c.motif is null
            join public.factures_importees fi on fi.facture_id = x.id
            cross join lateral jsonb_array_elements(fi.encaisse_par_taux) g(valeur)
           where x.reprise and (g.valeur ->> 'encaisse')::numeric <> 0) d
    left join montants m on m.facture_id = d.facture_id and m.taux = d.taux
    left join avoirs a on a.facture_id = d.facture_id and a.taux = d.taux and a.repris
   group by d.facture_id, d.taux, d.encaisse
),
departs_portes as (
  select d.facture_id, d.taux, d.encaisse,
         (sign(d.v * d.encaisse) * div(2 * abs(d.v * d.encaisse) + d.t, 2 * d.t))::bigint as portee
    from departs d
   where d.t > 0
),
-- Chaque taux d'une facture : sa chaîne de parts, dans l'ordre des encaissements, que la règle parcourt un rang à la
-- fois, toutes les factures ensemble. La part d'un encaissement porte ce que V × cumul / T arrondi rend (le demi loin de
-- zéro), moins ce que portaient les parts d'avant ; celle d'une contre-passation, l'opposé exact de la TVA de son
-- encaissement.
chaine as (
  select p.facture_id, p.taux, p.encaissement_id, p.annule_id, p.part, v.v, v.t,
         row_number() over (partition by p.facture_id, p.taux order by p.rang) as k
    from parts p
    join avant_le_cumul c on c.id = p.facture_id and c.motif is null
    left join vt v on v.encaissement_id = p.encaissement_id and v.taux = p.taux
),
cumul (facture_id, taux, k, encaissement_id, encaisse, portee, tva, tvas) as (
  -- Le premier rang part de rien ; d'une facture reprise (A8b), de son départ.
  select c.facture_id, c.taux, c.k, c.encaissement_id, coalesce(d.encaisse, 0) + c.part, coalesce(d.portee, 0) + x.tva,
         x.tva, jsonb_build_object(c.encaissement_id::text, x.tva)
    from chaine c
    left join departs_portes d on d.facture_id = c.facture_id and d.taux = c.taux
    cross join lateral (
      select case when c.annule_id is not null then null::bigint
                  when c.t > 0 then (sign(c.v * (coalesce(d.encaisse, 0) + c.part))
                                     * div(2 * abs(c.v * (coalesce(d.encaisse, 0) + c.part)) + c.t, 2 * c.t))::bigint
                                    - coalesce(d.portee, 0)
             end as tva) x
   where c.k = 1
  union all
  select c.facture_id, c.taux, c.k, c.encaissement_id, r.encaisse + c.part, r.portee + x.tva, x.tva,
         r.tvas || jsonb_build_object(c.encaissement_id::text, x.tva)
    from cumul r
    join chaine c on c.facture_id = r.facture_id and c.taux = r.taux and c.k = r.k + 1
    cross join lateral (
      select case when c.annule_id is not null then -((r.tvas ->> c.annule_id::text)::bigint)
                  when c.t > 0 then (sign(c.v * (r.encaisse + c.part))
                                     * div(2 * abs(c.v * (r.encaisse + c.part)) + c.t, 2 * c.t))::bigint - r.portee
             end as tva) x
),
-- La facture écartée par la règle : au premier encaissement, dans leur ordre, qui est une contre-passation qui n'est pas
-- l'exact opposé, taux par taux, d'un encaissement compté avant elle, ou dont une part a un TTC que ses avoirs annulent.
signatures as (
  select p.encaissement_id,
         string_agg(trim_scale(p.taux)::text || ':' || p.part, ',' order by p.taux) as signature,
         string_agg(trim_scale(p.taux)::text || ':' || (-p.part), ',' order by p.taux) as opposee
    from parts p
   group by p.encaissement_id
),
echecs as (
  select e.facture_id, e.rang, 'contre_passation_illisible' as motif
    from encs e
    left join encs o on o.id = e.annule_id and o.facture_id = e.facture_id
    left join signatures s on s.encaissement_id = e.id
    left join signatures so on so.encaissement_id = o.id
   where e.annule_id is not null and (o.id is null or o.rang >= e.rang or s.signature is distinct from so.opposee)
  union all
  select v.facture_id, v.rang, 'ttc_nul'
    from vt v
   where v.t <= 0
  union all
  -- A8b : le départ d'une facture reprise, avant tout encaissement.
  select d.facture_id, 0, 'ttc_nul'
    from departs d
   where d.t <= 0
),
premiers_echecs as (
  select distinct on (z.facture_id) z.facture_id, z.motif from echecs z order by z.facture_id, z.rang
),
ecartees as (
  select c.id as facture_id, coalesce(c.motif, z.motif) as motif
    from avant_le_cumul c
    left join premiers_echecs z on z.facture_id = c.id
),
comptees as (
  select x.id, x.regime, x.nature_operation, x.date_emission, x.reprise,
         case when x.regime = 'livraison' then coalesce(x.date_prestation, x.date_emission) else x.date_emission end as fait
    from fac x
    join ecartees c on c.facture_id = x.id and c.motif is null
),
-- Ce qu'une facture comptée pèse : ses parts, ses documents — la facture et ses avoirs à leur date —, ses exigibilités.
part_lignes as (
  select p.facture_id, p.encaissement_id, p.date_encaissement as date_effet, p.taux, p.part as ttc, p.part - k.tva as base,
         k.tva
    from parts p
    join comptees q on q.id = p.facture_id
    join cumul k on k.facture_id = p.facture_id and k.taux = p.taux and k.encaissement_id = p.encaissement_id
),
-- Une facture reprise (A8b) n'a pas de document, ni ses avoirs repris : seuls les avoirs que l'application émet sur elle.
documents as (
  select m.facture_id, null::uuid as avoir_id, q.date_emission as date_effet, m.taux, m.ttc, m.base, m.tva
    from montants m
    join comptees q on q.id = m.facture_id
   where not q.reprise
  union all
  select a.facture_id, a.avoir_id, a.date_emission, a.taux, -a.ttc, -a.base, -a.tva
    from avoirs a
    join comptees q on q.id = a.facture_id
   where not a.repris
),
avoirs_au_fait as (
  select a.facture_id, a.taux, sum(a.tva) as tva, sum(a.base + a.tva) as ttc
    from avoirs a
    join comptees q on q.id = a.facture_id
   where q.regime <> 'encaissement' and a.date_emission <= q.fait
   group by a.facture_id, a.taux
),
parts_avant_le_fait as (
  select r.facture_id, r.taux, sum(r.tva) as tva, sum(r.base) as base
    from part_lignes r
    join comptees q on q.id = r.facture_id
   where q.regime <> 'encaissement' and r.date_effet < q.fait
   group by r.facture_id, r.taux
),
-- D'une facture reprise (A8b), pas de fait générateur : l'ancien logiciel a déclaré la TVA de sa livraison ou de sa
-- facture sur les débits.
taux_du_fait as (
  select m.facture_id, m.taux from montants m join comptees q on q.id = m.facture_id
   where q.regime <> 'encaissement' and not q.reprise
  union
  select a.facture_id, a.taux from avoirs a join comptees q on q.id = a.facture_id
   where q.regime <> 'encaissement' and not q.reprise
),
au_fait as (
  select u.facture_id, case when q.regime = 'livraison' then 'livraison' else 'facture' end as origine, q.fait, u.taux,
         coalesce(m.tva, 0) - coalesce(af.tva, 0) as v, coalesce(m.base + m.tva, 0) - coalesce(af.ttc, 0) as t,
         coalesce(pa.tva, 0) as tva_avant, coalesce(pa.base, 0) as ht_avant
    from taux_du_fait u
    join comptees q on q.id = u.facture_id
    left join montants m on m.facture_id = u.facture_id and m.taux = u.taux
    left join avoirs_au_fait af on af.facture_id = u.facture_id and af.taux = u.taux
    left join parts_avant_le_fait pa on pa.facture_id = u.facture_id and pa.taux = u.taux
),
exigibilites as (
  -- Des services : chaque part, à la date de son encaissement ; un bien ou des services sur les débits : les parts d'avant
  -- le fait générateur ; à lui, ce que la facture porte nette des avoirs datés jusque-là, moins ce que ces parts ont rendu
  -- exigible ; un avoir d'après, à sa date.
  select r.facture_id, 'encaissement' as origine, r.encaissement_id, null::uuid as avoir_id, r.date_effet, r.taux, r.tva
    from part_lignes r
    join comptees q on q.id = r.facture_id
   where q.regime = 'encaissement' or (r.date_effet < q.fait and not q.reprise)
  union all
  select g.facture_id, g.origine, null::uuid, null::uuid, g.fait, g.taux, g.v - g.tva_avant
    from au_fait g
   where g.t - g.v - g.ht_avant <> 0 or g.v - g.tva_avant <> 0
  union all
  select d.facture_id, 'avoir', null::uuid, d.avoir_id, d.date_effet, d.taux, d.tva
    from documents d
    join comptees q on q.id = d.facture_id
   where q.regime <> 'encaissement' and d.avoir_id is not null and d.date_effet > q.fait
),
exigibles as (
  select distinct g.encaissement_id, g.taux from exigibilites g where g.origine = 'encaissement'
),
-- ══ CE QUE CHAQUE SOURCE ÉCRIT : `ecriture_attendue_vente_facturee`, redite d'un bloc ══
-- La facture ou l'avoir : en engagement, le document à sa date ; dans les deux modèles, la TVA due avant l'encaissement.
soldes_documents as (
  select c.genre, c.id, d.date_effet as jour, x.compte, null::uuid as ligne, x.m
    from candidates c
    join documents d on d.facture_id = c.facture_id
                    and (c.genre = 'facture' and d.avoir_id is null or c.genre = 'avoir' and d.avoir_id = c.id)
    join comptees q on q.id = c.facture_id
    cross join dossier o
    cross join lateral (values (o.clients, d.ttc),
                               (case when q.nature_operation = 'biens' then o.ventes_de_biens else o.prestations end, -d.base),
                               (o.attente, -d.tva)) x(compte, m)
   where c.genre in ('facture', 'avoir') and o.mode = 'engagement'
  union all
  select c.genre, c.id, g.date_effet, x.compte, null::uuid, x.m
    from candidates c
    join exigibilites g on g.facture_id = c.facture_id and g.origine <> 'encaissement'
                       and (c.genre = 'facture' and g.origine in ('livraison', 'facture') or c.genre = 'avoir' and g.avoir_id = c.id)
    cross join dossier o
    cross join lateral (values (case when o.mode = 'tresorerie' then o.clients else o.attente end, g.tva),
                               (o.collectee, -g.tva)) x(compte, m)
   where c.genre in ('facture', 'avoir')
),
-- L'encaissement : son compte de trésorerie — la banque d'un mouvement de son jour, sinon les valeurs à l'encaissement
-- (la caisse pour des espèces), le compte de contrepartie choisi d'une compensation ou d'un autre moyen sans mouvement ;
-- une contre-passation sans mouvement défait son encaissement là où il a été écrit.
encaissements_sources as (
  select c.id, e.facture_id, e.date_encaissement,
         case when t.ligne_bancaire_id is not null
                then case when m.date = t.date_encaissement then o.banque
                          when t.moyen = 'especes' then o.caisse else o.valeurs end
              when t.moyen = 'especes' then o.caisse
              when t.moyen in ('compensation', 'autre') then t.compte_contrepartie
              else o.valeurs end as compte,
         case when t.ligne_bancaire_id is not null and m.date = t.date_encaissement then m.id end as ligne,
         case when t.ligne_bancaire_id is null and t.moyen in ('compensation', 'autre') and t.compte_contrepartie is null
                then 'compte_a_choisir'
              when t.ligne_bancaire_id is null and t.moyen in ('compensation', 'autre')
                   and public.refus_compte_de_contrepartie($1, t.compte_contrepartie) is not null
                then 'compte_refuse' end as motif,
         t.compte_contrepartie
    from candidates c
    join public.encaissements_factures e on e.id = c.id and e.dossier_id = $1
    left join public.encaissements_factures t
           on t.id = case when e.annule_id is not null and e.ligne_bancaire_id is null then e.annule_id else e.id end
    left join public.lignes_bancaires m on m.id = t.ligne_bancaire_id
    cross join dossier o
   where c.genre = 'encaissement'
),
encaissements_comptes as (
  select distinct r.encaissement_id from part_lignes r
),
soldes_encaissements as (
  select 'encaissement' as genre, s.id, s.date_encaissement as jour, x.compte, x.ligne, x.m
    from encaissements_sources s
    join part_lignes r on r.encaissement_id = s.id
    join comptees q on q.id = s.facture_id
    left join exigibles y on y.encaissement_id = s.id and y.taux = r.taux
    cross join dossier o
    cross join lateral (
      select s.compte, s.ligne, r.ttc
      union all
      select case when q.nature_operation = 'biens' then o.ventes_de_biens else o.prestations end, null::uuid, -r.base
       where o.mode = 'tresorerie'
      union all
      select case when y.encaissement_id is not null then o.collectee else o.clients end, null::uuid, -r.tva
       where o.mode = 'tresorerie'
      union all
      select o.clients, null::uuid, -r.ttc
       where o.mode = 'engagement'
      union all
      select o.attente, null::uuid, r.tva
       where o.mode = 'engagement' and y.encaissement_id is not null
      union all
      select o.collectee, null::uuid, -r.tva
       where o.mode = 'engagement' and y.encaissement_id is not null) x(compte, ligne, m)
   where s.motif is null
),
-- Le mouvement : ce qu'il porte, les encaissements non retirés qui le citent, qu'aucune contre-passation sans mouvement
-- n'annule ; la banque de ce que ceux du même jour n'ont pas porté — l'exemplaire d'une facture qui n'est pas source porte
-- la sienne, comme un encaissement du même jour —, le 511 (le 53) de ceux d'un autre jour, les frais du tout.
mouvements_sources as (
  select c.id, l.date as jour, (l.montant * 100)::bigint as montant, l.encaissements_de_factures as classe
    from candidates c
    join public.lignes_bancaires l on l.id = c.id and l.dossier_id = $1
   where c.genre = 'mouvement'
),
portes as (
  select s.id as mouvement_id, e.id, e.facture_id, e.date_encaissement, e.moyen, (e.montant * 100)::bigint as montant,
         f.statut in ('validee', 'importee') and f.source_de_la_vente as compte_sa_vente, f.source_de_la_vente as source,
         f.numero
    from mouvements_sources s
    join public.encaissements_factures e on e.ligne_bancaire_id = s.id and e.dossier_id = $1 and e.retire_le is null
    join public.factures_emises f on f.id = e.facture_id
   where not exists (select 1 from public.encaissements_factures n
                      where n.annule_id = e.id and n.retire_le is null and n.ligne_bancaire_id is null)
),
exemplaires as (
  select x.facture_id, count(*) as n
    from public.pieces x
   where x.dossier_id = $1 and x.statut = 'validee' and x.type_piece = 'vente'
     and x.facture_id in (select p.facture_id from portes p where not p.compte_sa_vente)
   group by x.facture_id
),
sans_exemplaire as (
  select distinct on (p.mouvement_id) p.mouvement_id, p.numero
    from portes p
    left join exemplaires x on x.facture_id = p.facture_id
   where not p.compte_sa_vente and coalesce(x.n, 0) <> 1
   order by p.mouvement_id, p.numero collate "C", p.facture_id
),
mouvements_juges as (
  select s.id, s.jour, s.montant, s.classe, bool_or(p.compte_sa_vente) as justifie,
         bool_or(z.motif is not null) as vente_ecartee, coalesce(sum(p.montant), 0) as total,
         coalesce(sum(p.montant) filter (where p.date_encaissement = s.jour or not p.source), 0) as meme_jour,
         n.numero as facture_non_source, n.mouvement_id is not null as sans_son_exemplaire
    from mouvements_sources s
    left join portes p on p.mouvement_id = s.id
    left join ecartees z on z.facture_id = p.facture_id
    left join sans_exemplaire n on n.mouvement_id = s.id
   group by s.id, s.jour, s.montant, s.classe, n.mouvement_id, n.numero
),
soldes_mouvements as (
  select 'mouvement' as genre, j.id, j.jour, case when p.moyen = 'especes' then o.caisse else o.valeurs end as compte,
         j.id as ligne, -p.montant as m
    from mouvements_juges j
    join portes p on p.mouvement_id = j.id and p.date_encaissement <> j.jour and p.source
    cross join dossier o
   where j.justifie and not j.sans_son_exemplaire and not coalesce(j.vente_ecartee, false)
  union all
  select 'mouvement', j.id, j.jour, x.compte, j.id, x.m
    from mouvements_juges j
    cross join dossier o
    cross join lateral (values (o.banque, j.montant - j.meme_jour), (o.frais_bancaires, j.total - j.montant)) x(compte, m)
   where j.justifie and not j.sans_son_exemplaire and not coalesce(j.vente_ecartee, false)
),
-- Les lignes : sommées par date, compte et mouvement, les nulles ôtées, triées octet par octet.
lignes_des_sources as (
  select s.genre, s.id, array_agg(s.texte order by s.texte collate "C") as lignes
    from (select y.genre, y.id,
                 to_char(y.jour, 'YYYY-MM-DD') || '|' || y.compte || '|' || case when sum(y.m) > 0 then 'debit' else 'credit' end
                 || '|' || abs(sum(y.m)) || '|' || coalesce(y.ligne::text, '') as texte
            from (select d.genre, d.id, d.jour, d.compte, d.ligne, d.m::numeric as m from soldes_documents d
                  union all
                  select e.genre, e.id, e.jour, e.compte, e.ligne, e.m::numeric from soldes_encaissements e
                  union all
                  select v.genre, v.id, v.jour, v.compte, v.ligne, v.m::numeric from soldes_mouvements v) y
           group by y.genre, y.id, y.jour, y.compte, y.ligne
          having sum(y.m) <> 0) s
   group by s.genre, s.id
)
select c.genre, c.id, c.date_source,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then 'vente_ecartee'
            when c.genre = 'encaissement' and k.encaissement_id is not null then es.motif
            when c.genre = 'mouvement' and j.justifie and j.sans_son_exemplaire then 'mouvement_facture_non_source'
            when c.genre = 'mouvement' and j.justifie and j.vente_ecartee then 'mouvement_vente_ecartee'
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null and not j.classe then 'mouvement_non_classe'
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null
                 and (j.total - j.montant < 0 or (j.total - j.montant) * 100 > least(50000, abs(j.total) * 2))
              then 'mouvement_ecart'
       end,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then z.motif
            when c.genre = 'encaissement' and k.encaissement_id is not null and es.motif = 'compte_refuse' then es.compte_contrepartie
            when c.genre = 'mouvement' and j.justifie and j.sans_son_exemplaire then j.facture_non_source
       end,
       case when c.genre in ('facture', 'avoir', 'encaissement') and z.motif is not null then '{}'::text[]
            when c.genre = 'encaissement' and es.motif is not null then '{}'::text[]
            when c.genre = 'mouvement' and j.justifie and l.lignes is not null
                 and (not j.classe or j.total - j.montant < 0 or (j.total - j.montant) * 100 > least(50000, abs(j.total) * 2))
              then '{}'::text[]
            else coalesce(l.lignes, '{}'::text[]) end
  from candidates c
  left join ecartees z on z.facture_id = c.facture_id
  left join encaissements_sources es on es.id = c.id and c.genre = 'encaissement'
  left join encaissements_comptes k on k.encaissement_id = c.id and c.genre = 'encaissement'
  left join mouvements_juges j on j.id = c.id and c.genre = 'mouvement'
  left join lignes_des_sources l on l.genre = c.genre and l.id = c.id
$q$ using p_dossier_id, p_frontiere, p_fin;
end
$function$
;

-- ══ 6. rapprocher_cotisation ══
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
$function$
;

-- ══ 7. rapprocher_declaration_tva ══
create or replace function public.rapprocher_declaration_tva(p_ligne_bancaire_id uuid, p_declaration_id uuid, p_ecriture jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_declaration public.declarations_tva%rowtype;
  v_a_payer numeric;
  v_compte text;
  v_banque text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  select * into v_declaration from public.declarations_tva where id = p_declaration_id;
  if not found or v_declaration.dossier_id <> v_ligne.dossier_id then
    raise exception 'Cette déclaration de TVA n''est pas celle de ce dossier.' using errcode = '22023';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.compte_bilan is not null then
    raise exception 'Ce mouvement est écrit sur le compte %, un compte de bilan : annule d''abord ce classement.',
      v_ligne.compte_bilan using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if v_ligne.date <= v_declaration.periode_fin then
    raise exception 'Un paiement de TVA suit la période qu''il règle : ce mouvement est du %, la période se termine le %.',
      to_char(v_ligne.date, 'DD/MM/YYYY'), to_char(v_declaration.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  v_a_payer := case when v_declaration.cases is null
    then greatest(v_declaration.tva_declaree - v_declaration.credit_anterieur, 0)
    else (v_declaration.cases->>'l32')::numeric end;
  if v_ligne.montant < 0 and coalesce(v_a_payer, 0) <= 0 then
    raise exception 'Cette déclaration n''a pas de TVA à payer.' using errcode = '22023';
  end if;
  if v_ligne.montant > 0 and v_declaration.remboursement_demande <= 0 then
    raise exception 'Aucun remboursement de crédit n''a été demandé sur cette déclaration (ligne 26).' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
     where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_compte := public.compte_du_role(v_ligne.dossier_id,
    case when v_ligne.montant < 0 then 'tva_a_decaisser' else 'remboursement_tva_demande' end);
  if jsonb_typeof(p_ecriture) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select v_banque as compte, case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select v_compte, case when v_ligne.montant > 0 then 'credit' else 'debit' end, abs(v_ligne.montant)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
      from jsonb_array_elements(p_ecriture) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette déclaration.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set declaration_tva_id = p_declaration_id, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
    from jsonb_array_elements(p_ecriture) as e;
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
$function$
;

-- ══ 8. rapprocher_echeance_emprunt ══
create or replace function public.rapprocher_echeance_emprunt(p_ligne_bancaire_id uuid, p_emprunt_id uuid, p_echeance integer, p_interets numeric, p_assurance numeric, p_ecritures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
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
$function$
;

-- ══ 9. refus_compte_de_contrepartie ══
create or replace function public.refus_compte_de_contrepartie(p_dossier_id uuid, p_compte text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(p_compte, '') !~ '^[1-5][0-9]{5,9}$' then
    return 'Un compte de contrepartie est un compte de bilan, de classe 1 à 5, de six à dix chiffres.';
  end if;
  if p_compte = public.compte_du_role(p_dossier_id, 'clients') then
    return 'Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.';
  end if;
  if p_compte in (public.compte_du_role(p_dossier_id, 'banque'), public.compte_du_role(p_dossier_id, 'valeurs_a_l_encaissement'),
                  public.compte_du_role(p_dossier_id, 'caisse')) then
    return 'Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte.';
  end if;
  if p_compte like '445%' then
    return 'Un compte de TVA ne reçoit pas un encaissement : la TVA d’une vente s’écrit avec elle.';
  end if;
  return null;
end
$function$
;

-- ══ 10. ventiler_mouvement_bancaire ══
create or replace function public.ventiler_mouvement_bancaire(p_ligne_bancaire_id uuid, p_parts jsonb, p_ecritures jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_part record;
  v_somme numeric := 0;
  v_nb_parts integer;
  v_nb_cibles integer;
  v_assujetti boolean;
  v_compte_dirigeant text;
  v_banque text;
  v_tva_collectee text;
  v_libelle text;
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
     or v_ligne.emprunt_id is not null or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Les parts : au moins deux — une seule serait une affectation, qui a sa forme à elle —, chacune une
  -- cible et un montant non nul au centime (la colonne arrondirait en silence), une part par cible, et
  -- leur somme est le mouvement, au centime.
  if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'Une ventilation porte au moins deux parts.' using errcode = '22023';
  end if;
  for v_part in
    select (e->>'categorie_id')::uuid as categorie_id,
           coalesce((e->>'part_personnelle')::boolean, false) as part_personnelle,
           (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_parts) as e
  loop
    if num_nonnulls(v_part.categorie_id, nullif(v_part.part_personnelle, false)) <> 1 then
      raise exception 'Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.'
        using errcode = '22023';
    end if;
    if v_part.montant is null or v_part.montant = 0 or v_part.montant <> round(v_part.montant, 2) then
      raise exception 'Chaque part porte un montant non nul, au centime.' using errcode = '22023';
    end if;
    v_somme := v_somme + v_part.montant;
  end loop;
  select count(*), count(distinct coalesce((e->>'categorie_id')::uuid::text, 'dirigeant'))
    into v_nb_parts, v_nb_cibles
  from jsonb_array_elements(p_parts) as e;
  if v_nb_cibles <> v_nb_parts then
    raise exception 'Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.'
      using errcode = '22023';
  end if;
  if v_somme <> v_ligne.montant then
    raise exception 'Les parts font % € au lieu des % € du mouvement.',
      replace(to_char(v_somme, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_ligne.montant, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
     where e->>'categorie_id' is not null
       and not exists (
         select 1 from public.categories c
          where c.id = (e->>'categorie_id')::uuid
            and (c.dossier_id is null or c.dossier_id = v_ligne.dossier_id)
       )
  ) then
    raise exception 'Cette catégorie n''existe pas pour ce dossier.' using errcode = '22023';
  end if;
  select c.libelle into v_libelle
    from public.categories c
   where c.id in (select (e->>'categorie_id')::uuid from jsonb_array_elements(p_parts) as e)
     and (c.compte_comptable is null or c.compte_comptable !~ '^[67][0-9]{2}')
   order by c.libelle
   limit 1;
  if found then
    raise exception 'La catégorie « % » n''a pas de compte de charge ou de produit (classe 6 ou 7).', v_libelle
      using errcode = '22023';
  end if;
  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  v_tva_collectee := public.compte_du_role(v_ligne.dossier_id, 'tva_collectee');
  select assujetti_tva, public.compte_du_dirigeant(id)
    into v_assujetti, v_compte_dirigeant
  from public.dossiers where id = v_ligne.dossier_id;

  -- Le taux de chaque part : exigé pour une part de recette d'un dossier assujetti, refusé ailleurs. La
  -- première part fautive dans l'ordre des libellés, comme ci-dessus : deux parts fautives ne font pas
  -- deux messages différents selon leur ordre.
  select c.libelle into v_libelle
    from jsonb_array_elements(p_parts) as e
    join public.categories c on c.id = (e->>'categorie_id')::uuid
   where v_assujetti and c.compte_comptable ~ '^7' and e->>'taux_tva' is null
   order by c.libelle
   limit 1;
  if found then
    raise exception 'Sur un dossier assujetti à la TVA, la part « % » est une recette : choisis son taux, ou « exonérée ».', v_libelle
      using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
    left join public.categories c on c.id = (e->>'categorie_id')::uuid
    where e->>'taux_tva' is not null
      and not (v_assujetti and coalesce(c.compte_comptable ~ '^7', false))
  ) then
    raise exception 'Un taux de TVA ne s''applique qu''à une part de recette d''un dossier assujetti.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_parts) as e
    where (e->>'taux_tva')::numeric not in (0, 5.5, 8.5, 10, 20)
  ) then
    raise exception 'Ce taux de TVA n''est pas pris en charge.' using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, puis une ligne par part, sur
  -- le compte de sa catégorie ou celui du dirigeant, dans le sens de son signe — au hors taxe pour une
  -- part de recette taxée, dont la TVA collectée prend une ligne à côté. Comparée en MULTIENSEMBLE, comme
  -- celle d'une échéance d'emprunt : autant de lignes, et chacune des attendues présente.
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with parts as (
    select (e->>'categorie_id')::uuid as categorie_id, (e->>'montant')::numeric as montant,
           (e->>'taux_tva')::numeric as taux
    from jsonb_array_elements(p_parts) as e
  ), lignes_parts as (
    select coalesce(c.compte_comptable, v_compte_dirigeant) as compte,
           case when p.montant > 0 then 'credit' else 'debit' end as sens,
           abs(p.montant) as montant,
           coalesce(public.tva_incluse(p.montant, p.taux), 0) as tva
    from parts p left join public.categories c on c.id = p.categorie_id
  ), attendues as (
    select v_banque as compte,
           case when v_ligne.montant > 0 then 'debit' else 'credit' end as sens,
           abs(v_ligne.montant) as montant
    union all
    select compte, sens, montant - tva from lignes_parts
    union all
    select v_tva_collectee, sens, tva from lignes_parts where tva > 0
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set statut = 'rapprochee', ventilee = true
   where id = p_ligne_bancaire_id;

  delete from public.ventilations_bancaires where ligne_bancaire_id = p_ligne_bancaire_id;
  insert into public.ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant, taux_tva)
  select v_ligne.dossier_id, p_ligne_bancaire_id, (e->>'categorie_id')::uuid,
         coalesce((e->>'part_personnelle')::boolean, false), (e->>'montant')::numeric, (e->>'taux_tva')::numeric
  from jsonb_array_elements(p_parts) as e;

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
$function$
;
