-- EXP58-Q6 ET EXP58-Q7 — LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE DE COTISATION : LA CFP ET LA CURPS EN BS (lot L2, point 6 ;
-- décisions du cabinet du 19/11/2026, EXP58-Q6 (A) « la préparer maintenant, avant la validation de 2025 » et EXP58-Q7 (A) « la
-- part saisie par échéance depuis l'échéancier de l'Urssaf, l'estimation en rappel annuel »). PRÉPARÉE le 19/11/2026, PAS
-- APPLIQUÉE. Le récit : HISTORIQUE.md, « 19/11/2026 — EXP58-Q6 ET EXP58-Q7 : LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE (PRÉPARÉE,
-- PAS APPLIQUÉE) » ; l'analyse : docs/conceptions/58-reponses-de-l-expert-comptable.md, § 4.2 et § 12 ; l'essai :
-- supabase/essais/autresImpotsDesCotisations.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261119120100_retour_autres_impots_des_cotisations.sql ; l'écriture composée et la 2035 :
-- src/lib/cotisationRapprochee.ts, src/lib/cotisationPersonnelle.ts, src/lib/declaration2035.ts, derrière
-- `AUTRES_IMPOTS_DES_COTISATIONS_PREVUS` (src/lib/autresImpotsDesCotisations.ts), baissé jusqu'à l'application.
--
-- LE CAS. L'Urssaf appelle avec les cotisations sociales personnelles d'un praticien deux contributions qui n'en sont pas : la
-- contribution à la formation professionnelle des travailleurs indépendants (C. trav., art. L. 6331-48 : 0,25 % du plafond
-- annuel de la sécurité sociale pour une profession libérale) et la contribution aux unions régionales des professionnels de
-- santé (CURPS, CSP, art. L. 4031-4 : recouvrée par les organismes du recouvrement du régime général). L'application les
-- laissait dans l'échéance, au compte des cotisations de l'exploitant (646000 par défaut) et en BK ; l'expert-comptable les
-- range « dans un sous-compte des autres impôts » (sa réponse 2035E-9), donc en BS, ligne 13 « Autres impôts » de la 2035-A,
-- une liste ouverte. Le résultat ne change pas : BK et BT baissent de la part, BS monte d'autant.
--
-- LE COMPTE (EXP58-Q7) : aucun FEC du logiciel de l'expert-comptable ne le dit dans le dépôt. Le plan comptable général
-- (règlement ANC n° 2014-03, version consolidée au 1er janvier 2026, art. 1121-1, liste des comptes, classe 63) range les
-- autres impôts sous deux comptes, selon qui les perçoit : 635 « Autres impôts, taxes et versements assimilés
-- (administrations des impôts) », et 637 « Autres impôts, taxes et versements assimilés (autres organismes) », dont 6378
-- « Taxes diverses ». L'Urssaf n'est pas l'administration des impôts : le défaut est 637800 « Taxes diverses », un
-- sous-compte du 637 ; le 635 est parmi les racines du rôle, qu'un dossier choisit dans son plan (le 633, « sur
-- rémunérations », celui des employeurs, n'en est pas). Un nouveau rôle du catalogue, `autres_impots`, au rang 660 — après
-- ceux que les migrations préparées réservent (330 à 650).
--
-- CE QU'ELLE POSE :
--   1. `cotisations_declarees.montant_autres_impots` (numeric, NULLABLE, sans défaut), sur le patron de `montant_csg_crds` :
--      la part de l'échéance que l'échéancier ou l'avis de l'Urssaf attribue à la CFP et à la CURPS, saisie échéance par
--      échéance — jamais répartie depuis l'estimation de l'année. Comme la CSG-CRDS, aucune contrainte de la ligne : sa
--      valeur absolue compte, dans le sens de l'échéance, et les deux fonctions qui l'écrivent la refusent si elle n'est pas
--      au centime ou si, avec la CSG-CRDS, elle dépasse ce qu'elle partage. Nulle sur toute échéance d'hier : rien ne change
--      pour elles. Ajoutée au catalogue seul, sans réécrire la table.
--   2. Le rôle `autres_impots` au catalogue (`roles_comptables`) : racines 635 et 637, défaut 637800, « Taxes diverses »,
--      sans préfixe d'auxiliaire. `plan_du_dossier` le rend pour tout dossier, `compte_du_role` son défaut à un dossier qui
--      ne le règle pas, `garder_plan_comptable_dossier` et `regler_plan_du_dossier` le jugent sous ses racines, et le modèle
--      du cabinet le porte : aucune de ces fonctions ne change.
--   3. `rapprocher_cotisation` remplacée, à partir du corps de `jambe_de_banque_par_compte` (vérifié en tête) : l'écriture
--      attendue porte une ligne de plus, la part au compte du rôle `autres_impots`, dans le sens du mouvement — en
--      trésorerie comme en engagement : ce n'est pas une part de l'exploitant (la CSG-CRDS, elle, ne passe au compte de
--      l'exploitant qu'en trésorerie), c'est une charge d'impôt ; la cotisation au compte du rôle `cotisations_exploitant`
--      baisse d'autant. Deux refus neufs, en 22023, après ceux de la CSG-CRDS : une part qui n'est pas au centime, une part
--      qui, avec la CSG-CRDS, dépasse le mouvement. Le reste du corps, au caractère près.
--   4. `enregistrer_paiement_personnel_cotisation` remplacée, à partir du corps de `la_base_lit_le_plan_1` (vérifié) : la
--      même ligne de plus, face au compte du dirigeant, qui porte toujours l'échéance hors CSG-CRDS ; les deux mêmes refus,
--      face au montant de l'échéance. Le reste du corps, au caractère près.
--   5. `garder_paiement_personnel` remplacée, à partir du corps de `paiement_personnel_des_cotisations` (vérifié) : la part
--      rejoint les montants qu'une échéance payée depuis le compte personnel ne change plus tant que ce paiement tient — son
--      écriture la porte. Ses mots ne changent pas.
--
-- CE QU'ELLE NE CHANGE PAS : aucune policy, aucune table neuve, aucune donnée ; aucun droit (CREATE OR REPLACE garde le
-- propriétaire, les droits et la sécurité de chaque fonction). `garder_cotisation_valide` fige déjà la ligne entière d'une
-- échéance d'un exercice validé, sa description seule exceptée : la part s'y fige d'elle-même. `valider_exercice` n'a rien à
-- apprendre : « Autres impôts » est déjà dans ses listes fermées, sur une ligne de charge (classe 6). `supprimer_echeance_cotisation`,
-- `retirer_paiement_personnel_cotisation`, `retirer_rapprochement_cotisation` retirent les lignes d'une écriture quel qu'en
-- soit le compte : rien à changer. La sauvegarde lit la table par `select('*')` et la restauration réinsère ce qu'elle a lu :
-- une sauvegarde d'avant se restaure (la part nulle). Les écritures déjà passées restent ce qu'elles sont : une part saisie
-- sur une échéance déjà rapprochée rend son écriture « à réécrire » (« Écrire les N », comme une CSG-CRDS saisie après
-- coup), et la concordance de la 2035 le dit d'ici là.
--
-- LE SOCLE, LE JOUR DE L'APPLICATION : `cotisations_declarees` est une table du socle — supabase/schema/socle/
-- 1_tables_sans_migration.sql se régénère du catalogue (supabase/essais/socle.sql) et change d'une ligne dans son
-- `create table public.cotisations_declarees` : après `  part_regularisation numeric,`, la ligne
-- `  montant_autres_impots numeric,` (le nombre d'instructions ne change pas, 83 ; relevé sur une copie de la réplique portée
-- à 241 : `7939ff1c…`, puis `3196ecfd…`). `roles_comptables` n'en est pas une. L'inventaire compte un objet de plus, la
-- colonne (3 259, puis 3 260) : les trois fonctions existent déjà, et une ligne du catalogue des rôles n'est pas un objet.
--
-- COMMENT ELLE S'APPLIQUE : COLLÉE PAR LE CABINET, dans une transaction, avec sa ligne d'historique — le corps de
-- `rapprocher_cotisation` retire l'écriture qu'il remplace (comme hier), et l'outil d'application attend alors une
-- confirmation qui n'arrive pas. Aucune barre oblique inverse. Indépendante des autres migrations préparées : aucune ne
-- remplace ces trois fonctions ni ne touche `cotisations_declarees` ; `cumul_repris_des_biens` (EXP58-Q5) ne touche ni le
-- catalogue des rôles ni les cotisations, et elle se colle avant ou après elle. Le rang 660 est hors de ceux qu'elles
-- réservent. Le jour de son application, `AUTRES_IMPOTS_DES_COTISATIONS_PREVUS` se lève (l'écran, la 2035, le FEC, la
-- lecture du plan), la constante de même nom de l'assistant aussi, et l'assistant se redéploie ; le fichier entre dans
-- supabase/schema/ sous la version de sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = 'public.cotisations_declarees'::regclass and a.attname = 'montant_autres_impots'
                and not a.attisdropped)
     or exists (select 1 from public.roles_comptables r where r.role = 'autres_impots') then
    raise exception 'EXP58-Q6 : la part « autres impôts » est déjà en base : cette migration ne se rejoue pas.';
  end if;
  -- Les colonnes de l'échéance que les trois fonctions lisent.
  if (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text, ', ' order by a.attname)
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.cotisations_declarees'::regclass and not a.attisdropped
         and a.attname in ('dossier_id', 'echeance', 'id', 'montant_appele', 'montant_csg_crds', 'montant_verse', 'paiement_personnel_le'))
     is distinct from 'dossier_id uuid true, echeance date true, id uuid true, montant_appele numeric true, montant_csg_crds numeric false, '
                      'montant_verse numeric false, paiement_personnel_le date false' then
    raise exception 'EXP58-Q6 : les colonnes de l''échéance que les fonctions lisent ont changé : relire la migration.';
  end if;
  -- Le rang 660 libre, et aucune racine du catalogue qui commence 635 ou 637, ni l'inverse (PCG, art. 1131-2 : un compte,
  -- un rôle).
  if exists (select 1 from public.roles_comptables r where r.ordre = 660) then
    raise exception 'EXP58-Q6 : le rang 660 du catalogue des rôles est pris : relire la migration.';
  end if;
  if exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
              cross join unnest(array['635', '637']) as n(neuve)
             where left(u.racine, length(n.neuve)) = n.neuve or left(n.neuve, length(u.racine)) = u.racine) then
    raise exception 'EXP58-Q6 : une racine du catalogue recouvre celles des autres impôts : relire la migration.';
  end if;
  -- Les fonctions que les corps neufs appellent, et les corps qu'elle remplace, ceux de la production (fins de ligne ramenées
  -- à la seule fin de ligne). Un autre remplaçant collé avant elle : elle se refuse, et se reprend sur le corps du jour.
  if to_regprocedure('public.compte_du_role(uuid, text)') is null
     or to_regprocedure('public.compte_de_banque_du_mouvement(uuid)') is null
     or to_regprocedure('public.compte_du_dirigeant(uuid)') is null then
    raise exception 'EXP58-Q6 : le plan du dossier ou la banque du mouvement ne se lisent pas : relire la migration.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname)
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)'),
                       to_regprocedure('public.enregistrer_paiement_personnel_cotisation(uuid, uuid, date, jsonb)'),
                       to_regprocedure('public.garder_paiement_personnel()')))
     is distinct from 'enregistrer_paiement_personnel_cotisation=413e4db0288b1507644f381f934ccf6a,'
                      'garder_paiement_personnel=3a165550bb61beb58d478eb9e4de1180,'
                      'rapprocher_cotisation=2559833009639c117795ad40d74dc31f' then
    raise exception 'EXP58-Q6 : une des trois fonctions n''a plus le corps sur lequel cette migration a été écrite : rien n''est remplacé.';
  end if;
end
$garde$;

-- ══ 1. La colonne ══════════
alter table public.cotisations_declarees add column montant_autres_impots numeric;

comment on column public.cotisations_declarees.montant_autres_impots is
  'La part de l''échéance que l''Urssaf appelle au titre de la contribution à la formation professionnelle (C. trav., art. L. 6331-48) et de la CURPS (CSP, art. L. 4031-4), saisie depuis l''échéancier ou l''avis — jamais répartie depuis l''estimation de l''année. Sa valeur absolue compte, dans le sens de l''échéance, au centime ; écrite au compte du rôle autres_impots (637800 par défaut) par rapprocher_cotisation et enregistrer_paiement_personnel_cotisation, comptée en BS (2035-A, ligne 13), jamais au compte des cotisations ni en BK. Nulle : aucune (une échéance d''avant).';

-- ══ 2. Le rôle du plan ══════════
insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('autres_impots', array['635', '637'], '637800', 'Taxes diverses', null, 660);

-- ══ 3. rapprocher_cotisation ══════════
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
  v_impots numeric := 0;
  v_date_autre date;
  v_banque text;
  v_compte_cotisations text;
  v_compte_exploitant text;
  v_compte_impots text;
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

  -- LA PART « AUTRES IMPÔTS » DE L'ÉCHÉANCE (EXP58-Q6, EXP58-Q7) : la contribution à la formation professionnelle et la
  -- CURPS que l'Urssaf appelle avec les cotisations, au compte du rôle `autres_impots` (637800 par défaut) — une charge
  -- d'impôt, rangée en BS sur la 2035, en trésorerie comme en engagement ; sa valeur absolue, dans le sens du mouvement,
  -- au centime. Avec la CSG-CRDS, elle ne peut pas dépasser le mouvement : la cotisation serait négative. Nulle (une
  -- échéance d'avant, ou sans elle), l'écriture d'hier.
  if v_cotisation.montant_autres_impots is not null then
    v_impots := abs(v_cotisation.montant_autres_impots);
  end if;
  if v_impots <> round(v_impots, 2) then
    raise exception 'La part « autres impôts » de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  if v_csg + v_impots > v_total then
    if v_csg = 0 then
      raise exception 'La part « autres impôts » de cette échéance (% €) dépasse le mouvement (% €).',
        replace(to_char(v_impots, 'FM999999999990.00'), '.', ','),
        replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
    raise exception 'La CSG-CRDS et la part « autres impôts » de cette échéance (% €) dépassent le mouvement (% €).',
      replace(to_char(v_csg + v_impots, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_total, 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- L'écriture attendue, comparée en MULTIENSEMBLE : autant de lignes, et chacune des attendues présente.
  -- Une ligne à zéro n'en est pas une (une échéance sans CSG-CRDS ni part « autres impôts » saisie, ou faite toute de
  -- CSG-CRDS et de cette part).
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
  v_compte_impots := public.compte_du_role(v_ligne.dossier_id, 'autres_impots');
  with attendues as (
    select a.compte, a.sens, a.montant from (values
      (v_banque, v_sens_banque, v_total),
      (v_compte_cotisations, v_sens_compte, v_total - v_csg - v_impots),
      (v_compte_exploitant, v_sens_compte, v_csg),
      (v_compte_impots, v_sens_compte, v_impots)
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
  'Rapproche un mouvement d''une échéance de cotisation ET écrit son écriture (la cotisation au compte du rôle cotisations_exploitant, sa CSG-CRDS en trésorerie à celui du rôle exploitant, sa part « autres impôts » — la CFP et la CURPS — à celui du rôle autres_impots — 646000, 108000 et 637800 par défaut —, face à la banque, dans le sens du mouvement), dans une transaction. Rejouée sur un mouvement déjà rapproché d''une échéance, elle remplace son rapprochement et son écriture.';

-- ══ 4. enregistrer_paiement_personnel_cotisation ══════════
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
  v_compte_impots text;
  v_montant numeric;
  v_csg numeric := 0;
  v_impots numeric := 0;
  v_net bigint;
  v_part bigint;
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
  v_compte_impots := public.compte_du_role(p_dossier_id, 'autres_impots');
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
  -- LA PART « AUTRES IMPÔTS » (EXP58-Q6, EXP58-Q7) : la contribution à la formation professionnelle et la CURPS de
  -- l'échéance, au compte du rôle `autres_impots` (637800 par défaut), en trésorerie comme en engagement, au centime ;
  -- avec la CSG-CRDS, elle ne peut pas dépasser l'échéance. Nulle, l'écriture d'hier.
  if v_cotisation.montant_autres_impots is not null then
    v_impots := abs(v_cotisation.montant_autres_impots);
  end if;
  if v_impots <> round(v_impots, 2) then
    raise exception 'La part « autres impôts » de cette échéance n''est pas au centime.' using errcode = '22023';
  end if;
  if v_csg + v_impots > abs(v_montant) then
    if v_csg = 0 then
      raise exception 'La part « autres impôts » de cette échéance (% €) dépasse son montant (% €).',
        replace(to_char(v_impots, 'FM999999999990.00'), '.', ','),
        replace(to_char(abs(v_montant), 'FM999999999990.00'), '.', ',')
        using errcode = '22023';
    end if;
    raise exception 'La CSG-CRDS et la part « autres impôts » de cette échéance (% €) dépassent son montant (% €).',
      replace(to_char(v_csg + v_impots, 'FM999999999990.00'), '.', ','),
      replace(to_char(abs(v_montant), 'FM999999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- L'écriture attendue, EN CENTIMES ENTIERS : la cotisation hors CSG-CRDS et hors part « autres impôts » au compte du
  -- rôle `cotisations_exploitant` (646000 par défaut), cette part à celui du rôle `autres_impots` (637800 par défaut),
  -- face au compte du dirigeant pour l'échéance hors CSG-CRDS ; dans le sens de l'échéance — un appel le débite, un
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
  v_part := (v_impots * 100)::bigint;
  v_sens_charge := case when v_montant > 0 then 'debit' else 'credit' end;
  v_sens_dirigeant := case when v_montant > 0 then 'credit' else 'debit' end;
  with attendues as (
    select a.compte, a.sens, a.centimes from (values
      (v_compte_cotisations, v_sens_charge, v_net - v_part),
      (v_compte_impots, v_sens_charge, v_part),
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
  'Déclare qu''une échéance de cotisation a été payée depuis le compte personnel de l''exploitant, à la date donnée, ET écrit son écriture (la cotisation hors CSG-CRDS en trésorerie et hors part « autres impôts » au compte du rôle cotisations_exploitant, cette part — la CFP et la CURPS — à celui du rôle autres_impots — 646000 et 637800 par défaut —, face au compte du dirigeant), dans une transaction. Ne remplace rien : un paiement déjà déclaré se retire d''abord.';

-- ══ 5. garder_paiement_personnel ══════════
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
     and (new.montant_appele, new.montant_verse, new.montant_csg_crds, new.montant_autres_impots, new.dossier_id)
         is distinct from (old.montant_appele, old.montant_verse, old.montant_csg_crds, old.montant_autres_impots, old.dossier_id) then
    raise exception 'Cette échéance est payée depuis le compte personnel, le % : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.',
      to_char(old.paiement_personnel_le, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;
