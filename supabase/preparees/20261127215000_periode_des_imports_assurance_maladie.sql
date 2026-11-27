-- LA PÉRIODE D'UN IMPORT DES PAIEMENTS DE L'ASSURANCE MALADIE, SUR SES SEULS PAIEMENTS INSÉRÉS (conception 53, § 14.1 ;
-- NOE4R-Q1 (A), réponse du cabinet du 27/11/2026) — PRÉPARÉE le 27/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md,
-- « 27/11/2026 — NOE4R-Q1 ET NOE4R-Q2 : LA PÉRIODE D'UN IMPORT ET LE REMPLACEMENT D'UNE JOURNÉE (PRÉPARÉES, PAS
-- APPLIQUÉES) » ; l'essai : supabase/essais/periodeDesImportsAssuranceMaladie.sql (et les étapes 24 et 72 de
-- paiementsAssuranceMaladie.sql, qui suivent la règle de la base) ; le retour :
-- supabase/preparees/retour/20261127215100_retour_periode_des_imports_assurance_maladie.sql ; le module qui redit la règle :
-- src/lib/paiementsAssuranceMaladie.ts (`periodeDeLImport`).
--
-- LA RÈGLE. `importer_paiements_assurance_maladie` (NOE3, en production depuis le 20/11/2026, 246) écrivait la période d'un
-- import — `periode_du`, `periode_au` — sur TOUS les paiements du fichier, ceux que la base passe (déjà en base aux mêmes
-- chiffres) compris : un fichier qui recouvrait un import d'avant disait une période plus large que ce qu'il apportait, et la
-- confirmation de son retrait nommait des journées qui ne partaient pas avec lui (la relecture adverse du 27/11/2026, laissée
-- au cabinet). La période est désormais la plus ancienne et la plus récente journée comptable des paiements que l'import
-- INSÈRE, et d'eux seuls. LES REJETS RESTENT CEUX DU FICHIER — le nombre et le montant que le fichier dit : un rejet ne porte
-- aucune clé que la base saurait passer ; l'écran le dit (« les rejets du fichier »).
--
-- UN IMPORT QUI N'INSÈRE RIEN SE REFUSE, COMME HIER (« Ces paiements sont déjà tous importés : rien de neuf. », 22023), au
-- lieu de s'écrire sans période : (1) il n'apporte aucun paiement à justifier ni à contrôler (NOE5, NOE6 ne lisent que des
-- paiements) ; (2) ses rejets sont ceux d'un fichier dont chaque paiement est déjà en base, donc déjà comptés par l'import qui
-- les a apportés ou par un autre qui le recouvrait : rien ne les rattache à une clé, la base ne saurait pas les passer, et les
-- écrire les compterait deux fois ; (3) une période nulle romprait le contrat de la table (`periode_du` et `periode_au` non
-- nuls, sa contrainte) et chacun de ses lecteurs (la liste des imports, les contrôles de NOE6, l'étendue de BOR5) ; (4) le refus
-- est celui d'hier, dit avant le clic par `refusAvantLEnvoi`. Le refus précédant l'écriture de l'import, l'agrégat de sa
-- période porte toujours au moins un paiement.
--
-- CE QU'ELLE CHANGE : le corps d'`importer_paiements_assurance_maladie` (son seul calcul de la période ; même signature,
-- mêmes droits, mêmes refus dans le même ordre, sous les mêmes mots), son commentaire et celui de la colonne `periode_du`.
-- Rien d'autre : ni table, ni colonne, ni policy, ni donnée. Un import écrit avant elle garde la période qu'il a reçue (la garde
-- de NOE3 refuse toute réécriture d'un import) : la base de production n'en porte aucun de réel (aucun premier import réel
-- n'est fait au 27/11/2026) ; une lecture de la session les compte avant le collage (le récit). `retirer_import_assurance_maladie`,
-- `refus_de_l_import_assurance_maladie` et les deux gardes sont intacts : l'association (NOE5, 247), qui en vérifie les
-- empreintes, n'est pas touchée. Le retour de NOE3 vérifie l'empreinte du corps d'hier : il suppose celui-ci joué d'abord.
--
-- LA GARDE DE TÊTE vérifie l'empreinte du corps qu'elle remplace (`62b9f0f6…`, celui de l'export, NOE3 ;
-- remplacementsDesPreparees.test.ts) et refuse une seconde application ; la garde de fin relit le corps posé, ses droits et son
-- chemin. Aucun mot de retrait dans ce texte : l'outil d'application le prend. Ni barre oblique inverse, ni retour chariot.
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version
-- que porte sa ligne d'historique, texte inchangé ; aucun drapeau ne l'attend (l'écran ne dit rien que la règle de la base
-- décide : sa confirmation nomme les journées des paiements qui partent, vraies sous l'une comme sous l'autre).

-- ══ 0. La garde de tête ══════════
do $garde$
declare
  v_nombre integer;
  v_empreinte text;
begin
  select count(*) into v_nombre from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'importer_paiements_assurance_maladie';
  select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
   where p.oid = to_regprocedure('public.importer_paiements_assurance_maladie(uuid,jsonb)');
  if v_empreinte = 'a7ebd230d249095bf4d247e0a6468f2f' then
    raise exception 'La migration periode_des_imports_assurance_maladie est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if v_nombre <> 1 or v_empreinte is distinct from '62b9f0f603ece252446552d81c39d24b' then
    raise exception 'La fonction public.importer_paiements_assurance_maladie(uuid,jsonb) n''est plus celle que cette migration remplace (empreinte attendue 62b9f0f6…) : la relire avant d''appliquer cette migration.';
  end if;
  if to_regclass('public.imports_assurance_maladie') is null or to_regclass('public.paiements_assurance_maladie') is null then
    raise exception 'Les tables des paiements de l''assurance maladie manquent : appliquer d''abord paiements_assurance_maladie (NOE3).';
  end if;
end
$garde$;

-- ══ 1. Importer ══════════
-- D'UN SEUL TENANT, sous un verrou des paiements du dossier (deux imports ne se croisent pas). Le jour est celui de Paris,
-- lu par la base. Un paiement déjà en base sous la même clé, AUX MÊMES CHIFFRES, ne se double pas : il est passé ; aux
-- chiffres différents, l'import se refuse (deux fichiers qui divergent ne se tranchent pas en silence). La période de l'import
-- est celle des seuls paiements qu'il insère (NOE4R-Q1) ; ses rejets, ceux du fichier.
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

  -- La période (NOE4R-Q1) : la plus ancienne et la plus récente journée des seuls paiements que l'import insère — ceux qu'aucun
  -- paiement en base ne porte encore sous leur clé, lus AVANT leur insertion ; le refus qui précède en garantit au moins un.
  -- Les rejets sont ceux du fichier.
  v_import.id := gen_random_uuid();
  perform set_config('jd.paiements_assurance_maladie', v_import.id::text, true);
  insert into public.imports_assurance_maladie (id, dossier_id, periode_du, periode_au, nombre_de_rejets, montant_rejete_centimes, importe_par)
  select v_import.id, p_dossier_id, min((e ->> 'date_journee_comptable')::date), max((e ->> 'date_journee_comptable')::date),
         (p_import #>> '{rejets,nombre}')::numeric::integer, (p_import #>> '{rejets,montant_centimes}')::numeric::bigint, auth.uid()
    from jsonb_array_elements(p_import -> 'paiements') e
   where not exists (
      select 1 from public.paiements_assurance_maladie p
       where p.dossier_id = p_dossier_id
         and p.date_journee_comptable = (e ->> 'date_journee_comptable')::date
         and p.regime is not distinct from (e ->> 'regime')::numeric::smallint
         and p.caisse is not distinct from (e ->> 'caisse')::numeric::smallint
         and p.part = e ->> 'part'
         and p.organisme_complementaire is not distinct from (e ->> 'organisme_complementaire')::numeric::bigint)
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
  'Importe les paiements de l''assurance maladie d''un dossier (NOE3), tout ou rien : des agrégats sans patient (version 1), le jour de Paris, hors des exercices validés ; un paiement déjà en base aux mêmes chiffres est passé, à d''autres chiffres l''import se refuse, et un import qui n''insère rien aussi. La période de l''import est celle des seuls paiements qu''il insère, ses rejets ceux du fichier (NOE4R-Q1). Au cabinet du dossier ou à un accès « Banque » de ce dossier (42501) ; rend l''import écrit.';
comment on column public.imports_assurance_maladie.periode_du is
  'La plus ancienne journée comptable des paiements que l''import a insérés (NOE4R-Q1 : ceux que la base passait, déjà importés, n''en sont pas) ; periode_au, la plus récente. Un import écrit avant cette règle porte celle de tout son fichier.';

-- ══ 2. La garde de fin ══════════
-- Le corps posé, à son empreinte ; la fonction aux droits du propriétaire, son chemin fixé, exécutée par authenticated, ni par
-- l'anonyme ni par PUBLIC.
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = to_regprocedure('public.importer_paiements_assurance_maladie(uuid,jsonb)'))
       is distinct from 'a7ebd230d249095bf4d247e0a6468f2f' then
    raise exception 'Le corps d''importer_paiements_assurance_maladie n''est pas celui que la migration pose.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid = 'public.importer_paiements_assurance_maladie(uuid, jsonb)'::regprocedure
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 1 then
    raise exception 'Les droits d''exécution d''importer_paiements_assurance_maladie ne sont plus ceux que NOE3 a posés.';
  end if;
end
$fin$;
