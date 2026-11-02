-- RETOUR ARRIÈRE DE `sens_des_regles_ignorees` (REGLES-Q1) — DESTRUCTIF, À ACCORDER PAR LE CABINET, À COLLER dans l'éditeur
-- SQL de Supabase, dans une transaction, avec sa ligne d'historique (le corps rendu de `rapprocher_cotisation` supprime des
-- écritures, et le texte retire une colonne et deux contraintes). La migration : supabase/preparees/
-- 20261102120000_sens_des_regles_ignorees.sql ; le récit : HISTORIQUE.md, « 02/11/2026 — LE SENS DES RÈGLES « TOUJOURS
-- IGNORER » ET LA COTISATION D'UN MOUVEMENT IGNORÉ, EN BASE (REGLES-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`SENS_DES_REGLES_IGNOREES_EXPORTE`, le fichier de la migration
-- sorti de l'export) et remise en ligne — levé, elle écrit `sens` à chaque règle neuve, et l'insertion se refuserait sans la
-- colonne —, PUIS ce texte.
--
-- CE QU'IL REND : `rapprocher_cotisation` d'hier, au caractère près (`a2a5c675…`, sa dernière définition dans
-- l'export, `lignes_propres_au_mouvement`) — elle rapproche de nouveau un mouvement ignoré ; la clé unique d'hier,
-- `regles_bancaires_ignorees_dossier_id_motif_key`, UNIQUE (dossier_id, motif), sous son nom et sa définition.
--
-- CE QU'IL RETIRE — ce qu'il DÉTRUIT : la colonne `sens` et ce qu'elle porte — le sens de chaque règle créée depuis la
-- migration, qui vaudra de nouveau pour les deux sens : une règle née d'un débit fera de nouveau ignorer les encaissements
-- de son motif ; ses deux contraintes, `regles_bancaires_ignorees_sens` et `regles_bancaires_ignorees_unique`. Aucune
-- ligne : il SE REFUSE tant qu'un motif d'un dossier porte plus d'une règle (un motif sous deux sens, ou un sens et une
-- règle d'avant) — la clé d'hier ne les admettrait pas, et choisir laquelle effacer revient au cabinet, une règle à la fois,
-- depuis l'onglet Banque. Une sauvegarde prise pendant que la migration était en base porte `sens` : elle ne se restaure
-- plus sur la base d'après ce retour sans retirer cette clé de ses lignes.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `sensDesReglesIgnorees.sql` EN ATTENTE, et les trois contrôles de l'export, le fichier de la migration sorti de l'export.

-- ══ 0. La garde ══════════
do $garde$
declare
  v_empreinte text;
  v_doublons integer;
begin
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = 'public.regles_bancaires_ignorees'::regclass and a.attname = 'sens' and not a.attisdropped) then
    raise exception 'La migration sens_des_regles_ignorees n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  if (select count(*) from pg_constraint c where c.conrelid = 'public.regles_bancaires_ignorees'::regclass
       and c.conname in ('regles_bancaires_ignorees_sens', 'regles_bancaires_ignorees_unique')) <> 2
     or exists (select 1 from pg_constraint c where c.conrelid = 'public.regles_bancaires_ignorees'::regclass
                 and c.conname = 'regles_bancaires_ignorees_dossier_id_motif_key') then
    raise exception 'Les contraintes des règles « toujours ignorer » ne sont plus celles que la migration a posées : relire la base avant ce retour.';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
   where p.oid = to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)');
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rapprocher_cotisation') <> 1
     or v_empreinte is distinct from 'bf920662bc500bc4fcf23aba0ce829e3' then
    raise exception 'La fonction rapprocher_cotisation n''est plus celle que la migration a posée (empreinte attendue bf920662…) : la relire avant ce retour.';
  end if;
  select count(*) into v_doublons from (
    select 1 from public.regles_bancaires_ignorees group by dossier_id, motif having count(*) > 1) d;
  if v_doublons > 0 then
    raise exception 'Ce retour ne se fait pas : % motif(s) portent plus d''une règle « toujours ignorer » dans leur dossier (un motif sous deux sens, ou un sens et une règle d''avant), et la clé d''hier n''en admet qu''une. Retirer d''abord, depuis l''onglet Banque, les règles en trop — ce choix revient au cabinet.', v_doublons;
  end if;
end
$garde$;

-- ══ 1. La fonction d'hier ══════════
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
$$;

-- ══ 2. La clé d'hier, puis les contraintes et la colonne de la migration ══════════
alter table public.regles_bancaires_ignorees
  add constraint regles_bancaires_ignorees_dossier_id_motif_key unique (dossier_id, motif);

alter table public.regles_bancaires_ignorees
  drop constraint regles_bancaires_ignorees_unique;

alter table public.regles_bancaires_ignorees
  drop constraint regles_bancaires_ignorees_sens;

alter table public.regles_bancaires_ignorees
  drop column sens;
