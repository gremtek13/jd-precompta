-- RETOUR ARRIÈRE DE `periode_des_imports_assurance_maladie` (conception 53, § 14.1 ; NOE4R-Q1 (A)) — PAR L'OUTIL : aucun mot
-- de retrait dans ce texte. La migration : supabase/preparees/20261127190000_periode_des_imports_assurance_maladie.sql
-- (préparée le 27/11/2026) ; le récit : HISTORIQUE.md, « 27/11/2026 — NOE4R-Q1 ET NOE4R-Q2 ».
--
-- L'ORDRE : D'ABORD le retour de `remplacement_des_journees_assurance_maladie` (NOE4R-Q2), s'il est en base — sa fonction appelle
-- celle-ci et sa garde de tête en exige le corps —, PUIS ce texte. Aucun drapeau à baisser : l'écran ne dit rien que la règle de
-- la base décide.
--
-- CE QU'IL REND : le corps d'`importer_paiements_assurance_maladie` d'avant la migration, à l'octet (son empreinte
-- `62b9f0f6…`, celle de l'export, NOE3), son commentaire et celui de la colonne `periode_du`. Ce qu'il ne rend pas : la période
-- des imports écrits sous la migration reste celle de leurs seuls paiements insérés (la garde de NOE3 refuse toute réécriture
-- d'un import) — un tel import se retire et se refait pour reprendre la règle d'hier. Il ne retire rien.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), l'essai
-- `periodeDesImportsAssuranceMaladie.sql` EN ATTENTE, les étapes 24 et 72 de `paiementsAssuranceMaladie.sql` sous la règle
-- d'hier, et les trois contrôles de l'export.

-- ══ 0. La garde ══════════
do $garde$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = to_regprocedure('public.importer_paiements_assurance_maladie(uuid,jsonb)'))
       is distinct from 'a7ebd230d249095bf4d247e0a6468f2f' then
    raise exception 'La fonction importer_paiements_assurance_maladie n''est pas celle que la migration periode_des_imports_assurance_maladie a posée (ou ce retour est déjà fait) : relire la base avant ce retour.';
  end if;
  if to_regprocedure('public.remplacer_journees_assurance_maladie(uuid,jsonb,uuid[])') is not null then
    raise exception 'Le remplacement des journées (NOE4R-Q2) est en base et appelle cette fonction : jouer d''abord son retour.';
  end if;
end
$garde$;

-- ══ 1. Le corps d'hier ══════════
create or replace function public.importer_paiements_assurance_maladie(p_dossier_id uuid, p_import jsonb)
  returns public.imports_assurance_maladie
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_refus text;
  v_conflit date;
  v_nouveaux integer;
  v_import public.imports_assurance_maladie;
begin
  if p_dossier_id is null
     or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'banque')) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('paiements_assurance_maladie:' || p_dossier_id::text, 0));
  v_refus := public.refus_de_l_import_assurance_maladie(p_import, v_jour);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_array_elements(p_import -> 'paiements') e
              join public.exercices_valides x
                on x.dossier_id = p_dossier_id
               and x.annee = extract(year from (e ->> 'date_journee_comptable')::date)::integer) then
    raise exception 'Un paiement de l''import tombe dans un exercice que le cabinet a validé : il ne s''importe plus.'
      using errcode = '22023';
  end if;

  select min((e ->> 'date_journee_comptable')::date) into v_conflit
    from jsonb_array_elements(p_import -> 'paiements') e
    join public.paiements_assurance_maladie p
      on p.dossier_id = p_dossier_id
     and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
     and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
     and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
     and p.part = e ->> 'part'
     and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint
   where p.montant_centimes <> (e ->> 'montant_centimes')::numeric::bigint
      or p.regularisations_centimes <> (e ->> 'regularisations_centimes')::numeric::bigint
      or p.nombre_de_factures <> (e ->> 'nombre_de_factures')::numeric::integer;
  if v_conflit is not null then
    raise exception 'Un paiement de l''import est déjà en base avec d''autres chiffres (la journée comptable du %) : retirer d''abord l''import qui le porte.',
      to_char(v_conflit, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  select count(*) into v_nouveaux
    from jsonb_array_elements(p_import -> 'paiements') e
   where not exists (
      select 1 from public.paiements_assurance_maladie p
       where p.dossier_id = p_dossier_id
         and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
         and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
         and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
         and p.part = e ->> 'part'
         and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint);
  if v_nouveaux = 0 then
    raise exception 'Ces paiements sont déjà tous importés : rien de neuf.' using errcode = '22023';
  end if;

  v_import.id := gen_random_uuid();
  perform set_config('jd.paiements_assurance_maladie', v_import.id::text, true);
  insert into public.imports_assurance_maladie (id, dossier_id, periode_du, periode_au, nombre_de_rejets, montant_rejete_centimes, importe_par)
  select v_import.id, p_dossier_id, min((e ->> 'date_journee_comptable')::date), max((e ->> 'date_journee_comptable')::date),
         (p_import #>> '{rejets,nombre}')::numeric::integer, (p_import #>> '{rejets,montant_centimes}')::numeric::bigint, auth.uid()
    from jsonb_array_elements(p_import -> 'paiements') e
  returning * into v_import;

  insert into public.paiements_assurance_maladie (dossier_id, import_id, date_journee_comptable, regime, caisse,
                                                  organisme_complementaire, part, montant_centimes, regularisations_centimes,
                                                  nombre_de_factures)
  select p_dossier_id, v_import.id, (e ->> 'date_journee_comptable')::date, (e ->> 'regime')::numeric::smallint, (e ->> 'caisse')::numeric::smallint,
         (e ->> 'organisme_complementaire')::numeric::bigint, e ->> 'part', (e ->> 'montant_centimes')::numeric::bigint,
         (e ->> 'regularisations_centimes')::numeric::bigint, (e ->> 'nombre_de_factures')::numeric::integer
    from jsonb_array_elements(p_import -> 'paiements') e
   where not exists (
      select 1 from public.paiements_assurance_maladie p
       where p.dossier_id = p_dossier_id
         and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
         and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
         and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
         and p.part = e ->> 'part'
         and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint);
  perform set_config('jd.paiements_assurance_maladie', '', true);
  return v_import;
end;
$$;

comment on function public.importer_paiements_assurance_maladie(uuid, jsonb) is
  'Importe les paiements de l''assurance maladie d''un dossier (NOE3), tout ou rien : des agrégats sans patient (version 1), le jour de Paris, hors des exercices validés ; un paiement déjà en base aux mêmes chiffres est passé, à d''autres chiffres l''import se refuse. Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501) ; rend l''import écrit.';

comment on column public.imports_assurance_maladie.periode_du is
  'La plus ancienne journée comptable que le fichier portait (paiements déjà importés compris).';

-- ══ 2. La garde de fin ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = to_regprocedure('public.importer_paiements_assurance_maladie(uuid,jsonb)'))
       is distinct from '62b9f0f603ece252446552d81c39d24b' then
    raise exception 'Le corps rendu d''importer_paiements_assurance_maladie n''est pas celui d''avant la migration.';
  end if;
end
$fin$;
