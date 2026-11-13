-- LE CUMUL EMPLOI-RETRAITE ET LA DISPENSE DU COMPLÉMENTAIRE D'UN MÉDECIN, PAR EXERCICE (ligne 27.1 ; RET-Q2, tranchée par
-- le cabinet le 11/11/2026 : « Oui, avec l'écran ») — PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md,
-- « 13/11/2026 — B4RS-Q1, P1T-Q2 ET RET-Q2 » ; l'essai : supabase/essais/parametresDesCotisations.sql (étapes 8a à 8h, EN
-- ATTENTE sans elle) ; le retour : supabase/preparees/retour/20261113203100_retour_cumul_et_dispense_du_medecin.sql.
--
-- SOURCES (publiques, de la CARMF). « Déclaration en vue de l'affiliation » 2026 (carmf.fr, formulaire-affiliation.pdf) :
-- « LES DISPENSES AUTOMATIQUES DE COTISATIONS — Régime complémentaire vieillesse si début d'activité avant l'âge de 40 ans.
-- Dispense de la totalité de la cotisation pendant les deux premières années d'affiliation » ; et « l'affiliation […] sera
-- prononcée au premier jour du trimestre civil qui suit le début de votre activité libérale ». « Début d'exercice libéral »
-- 2026 (carmf.fr, debut-exercice-liberal.pdf) : « Les cotisations des deux premières années d'affiliation ne sont pas dues,
-- sauf si vous êtes âgé de plus de 40 ans au début de votre activité libérale », sous « 1re année d'affiliation en 2026
-- (médecin de moins de 40 ans) / 2e année d'affiliation en 2026 ». « Guide du cumul retraite/activité libérale », juin 2026
-- (carmf.fr, guide-cumul.pdf) : « Si vous cumulez retraite et activité libérale, vous ne cotisez plus au régime
-- invalidité-décès. » Le moteur de l'Urssaf (`modele-ti`, « CARMF . en retraite ») le suit pour l'invalidité-décès.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. Deux colonnes de `parametres_des_cotisations`, nulles tant que le cabinet ne les a pas dites, d'un exercice :
--      `cumul_emploi_retraite` (le médecin cumule-t-il sa retraite et son activité ?) et `dispense_complementaire` (la CARMF
--      le dispense-t-elle du complémentaire, ses deux premières années d'affiliation, installé avant quarante ans ?).
--      L'application ne sait pas l'âge : la seconde se DIT, elle ne se déduit pas. Elles suivent la ligne : figées avec
--      l'exercice validé (la garde du gel compare la ligne entière, `to_jsonb`), lues par le cabinet du dossier seul (la
--      policy d'hier), au plan de sauvegarde avec elle.
--   2. `enregistrer_parametres_des_cotisations`, même signature, aux droits de l'appelant : les valeurs lues et saisies
--      portent les trois clés d'hier — et la fonction n'écrit alors ni ne compare les deux cases, l'écran d'aujourd'hui
--      enregistrant comme hier — ou les cinq clés de RET-Q2, les deux cases comprises, comparées aux valeurs lues comme les
--      autres (40001) ; la même forme des deux côtés, sinon 22023. Le reste au caractère près : les refus, leur ordre, leurs
--      mots, le verrou, ce qui ne change pas ne s'écrit pas.
--
-- CE QU'ELLE NE CHANGE PAS : `debuts_d_activite`, les contraintes, la policy, la garde du gel, aucune donnée (aucune ligne
-- ne reçoit une case). Une estimation d'hier reste celle d'hier tant que `CASES_DU_MEDECIN_PREVUES`
-- (src/lib/parametresDesCotisations.ts) est baissé.
--
-- L'ORDRE : elle ne suppose que `parametres_des_cotisations` (en production) ; elle s'applique avant ou après la porte
-- d'accès (`acces_avant_les_gardes`, préparée), qui couvre déjà cette table. D'abord la migration, puis le drapeau levé :
-- l'écran levé envoie les cinq clés, que la fonction d'hier refuserait.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée ; `create or replace` d'une fonction, deux colonnes ajoutées. Ni
-- barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL. Son retour retire les deux colonnes et ce qu'elles
-- portent, et rend la fonction d'hier : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `CASES_DU_MEDECIN_PREVUES` se lève alors.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction d'écriture qui ne serait plus celle de la production (l'empreinte de
-- son corps, les retours chariot d'un collage écartés) ; une garde du gel qui ne comparerait plus la ligne entière.
do $garde$
begin
  if exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass
              and a.attname in ('cumul_emploi_retraite', 'dispense_complementaire') and not a.attisdropped) then
    raise exception 'La migration cumul_et_dispense_du_medecin est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p
                           where p.oid = to_regprocedure('public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)')), ''), chr(13), ''))
       <> '30d980ad27616ce7a749e39a9f31071c' then
    raise exception 'enregistrer_parametres_des_cotisations n''est plus celle de la production (empreinte attendue 30d980ad…) : la relire avant d''appliquer cette migration.';
  end if;
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p
                           where p.oid = to_regprocedure('public.garder_parametres_des_cotisations_valides()')), ''), chr(13), ''))
       <> 'bdc8847964b7473787c9af1310683c50' then
    raise exception 'La garde du gel des paramètres n''est plus celle de la production (empreinte attendue bdc88479…) : elle doit comparer la ligne entière, les deux cases comprises.';
  end if;
end
$garde$;

-- ══ 1. Les deux cases d'un exercice ══════════
alter table public.parametres_des_cotisations
  add column cumul_emploi_retraite boolean,
  add column dispense_complementaire boolean;

comment on column public.parametres_des_cotisations.cumul_emploi_retraite is
  'Un médecin : cumule-t-il sa retraite et son activité sur cet exercice ? Alors la CARMF ne lui appelle plus l''invalidité-décès (guide du cumul de la CARMF, 2026). Nul : non dit (RET-Q2).';
comment on column public.parametres_des_cotisations.dispense_complementaire is
  'Un médecin : la CARMF le dispense-t-elle du complémentaire sur cet exercice — ses deux premières années d''affiliation, son activité commencée avant quarante ans (déclaration en vue de l''affiliation de la CARMF, 2026) ? Dit par le cabinet, jamais déduit : l''application ne sait pas l''âge. Nul : non dit (RET-Q2).';

-- ══ 2. L'écriture d'un exercice : trois clés, ou cinq ══════════
create or replace function public.enregistrer_parametres_des_cotisations(p_dossier_id uuid, p_annee integer, p_lus jsonb, p_saisis jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cles constant text[] := array['acre', 'debut_activite', 'taux_dentiste'];
  -- RET-Q2 : les cinq clés, les deux cases d'un médecin comprises ; la même forme pour les valeurs lues et les saisies.
  v_cles_du_medecin constant text[] := array['acre', 'cumul_emploi_retraite', 'debut_activite', 'dispense_complementaire', 'taux_dentiste'];
  v_avec_les_cases boolean;
  v_objet jsonb;
  v_debut_lu date;
  v_debut_saisi date;
  v_acre_lu boolean;
  v_acre_saisi boolean;
  v_taux_lu numeric;
  v_taux_saisi numeric;
  v_cumul_lu boolean;
  v_cumul_saisi boolean;
  v_dispense_lue boolean;
  v_dispense_saisie boolean;
  v_debut_actuel date;
  v_acre_actuel boolean;
  v_taux_actuel numeric;
  v_cumul_actuel boolean;
  v_dispense_actuelle boolean;
  v_n integer := 0;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lus) is distinct from 'object' or jsonb_typeof(p_saisis) is distinct from 'object' then
    raise exception 'Les paramètres des cotisations partent mal formés : un exercice, les valeurs saisies et celles lues.'
      using errcode = '22023';
  end if;
  v_avec_les_cases := (select array_agg(k order by k collate "C") from jsonb_object_keys(p_saisis) k) is not distinct from v_cles_du_medecin;
  foreach v_objet in array array[p_lus, p_saisis] loop
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_objet) k)
         is distinct from (case when v_avec_les_cases then v_cles_du_medecin else v_cles end)
       or jsonb_typeof(v_objet -> 'debut_activite') not in ('string', 'null')
       or jsonb_typeof(v_objet -> 'acre') not in ('boolean', 'null')
       or jsonb_typeof(v_objet -> 'taux_dentiste') not in ('number', 'null')
       or (v_avec_les_cases and (jsonb_typeof(v_objet -> 'cumul_emploi_retraite') not in ('boolean', 'null')
                                 or jsonb_typeof(v_objet -> 'dispense_complementaire') not in ('boolean', 'null')))
       or (jsonb_typeof(v_objet -> 'debut_activite') = 'string' and (v_objet ->> 'debut_activite') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      raise exception 'Les paramètres des cotisations partent mal formés : le début d''activité (AAAA-MM-JJ), l''ACRE et le taux dentiste, saisis et lus.'
        using errcode = '22023';
    end if;
  end loop;
  begin
    v_debut_lu := (p_lus ->> 'debut_activite')::date;
    v_debut_saisi := (p_saisis ->> 'debut_activite')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Le début d''activité n''est pas une date du calendrier.' using errcode = '22023';
  end;
  v_acre_lu := (p_lus ->> 'acre')::boolean;
  v_acre_saisi := (p_saisis ->> 'acre')::boolean;
  v_taux_lu := (p_lus ->> 'taux_dentiste')::numeric;
  v_taux_saisi := (p_saisis ->> 'taux_dentiste')::numeric;
  v_cumul_lu := (p_lus ->> 'cumul_emploi_retraite')::boolean;
  v_cumul_saisi := (p_saisis ->> 'cumul_emploi_retraite')::boolean;
  v_dispense_lue := (p_lus ->> 'dispense_complementaire')::boolean;
  v_dispense_saisie := (p_saisis ->> 'dispense_complementaire')::boolean;
  perform pg_advisory_xact_lock(hashtextextended('parametres_des_cotisations:' || p_dossier_id::text, 0));
  select d.date_debut into v_debut_actuel from public.debuts_d_activite d where d.dossier_id = p_dossier_id;
  select c.acre, c.taux_dentiste, c.cumul_emploi_retraite, c.dispense_complementaire
    into v_acre_actuel, v_taux_actuel, v_cumul_actuel, v_dispense_actuelle
    from public.parametres_des_cotisations c where c.dossier_id = p_dossier_id and c.annee = p_annee;
  if v_debut_actuel is distinct from v_debut_lu or v_acre_actuel is distinct from v_acre_lu
     or v_taux_actuel is distinct from v_taux_lu
     or (v_avec_les_cases and (v_cumul_actuel is distinct from v_cumul_lu or v_dispense_actuelle is distinct from v_dispense_lue)) then
    raise exception 'Les paramètres des cotisations de l''exercice % ont changé depuis leur lecture : relis-les avant de les enregistrer.', p_annee
      using errcode = '40001';
  end if;
  if v_debut_saisi is distinct from v_debut_actuel then
    insert into public.debuts_d_activite (dossier_id, date_debut) values (p_dossier_id, v_debut_saisi)
      on conflict on constraint debuts_d_activite_un_par_dossier do update
        set date_debut = excluded.date_debut, updated_at = now();
    v_n := v_n + 1;
  end if;
  -- Sous la forme à trois clés, les deux cases ne s'écrivent pas : elles gardent ce qu'elles sont (nulles à la création).
  if not v_avec_les_cases then
    v_cumul_saisi := v_cumul_actuel;
    v_dispense_saisie := v_dispense_actuelle;
  end if;
  if v_acre_saisi is distinct from v_acre_actuel or v_taux_saisi is distinct from v_taux_actuel
     or v_cumul_saisi is distinct from v_cumul_actuel or v_dispense_saisie is distinct from v_dispense_actuelle then
    insert into public.parametres_des_cotisations (dossier_id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire)
      values (p_dossier_id, p_annee, v_acre_saisi, v_taux_saisi, v_cumul_saisi, v_dispense_saisie)
      on conflict on constraint parametres_des_cotisations_un_par_exercice do update
        set acre = excluded.acre, taux_dentiste = excluded.taux_dentiste, cumul_emploi_retraite = excluded.cumul_emploi_retraite,
            dispense_complementaire = excluded.dispense_complementaire, updated_at = now();
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

comment on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) is
  'Le début d''activité du dossier et l''ACRE, le taux dentiste — et, sous la forme à cinq clés, le cumul emploi-retraite et la dispense du complémentaire d''un médecin — d''un exercice, tout ou rien, contre les valeurs lues qu''ils remplacent (TNS-Q1, TNS-Q4, RET-Q2). Aux droits de l''appelant.';

-- ══ 3. La garde de fin ══════════
do $fin$
begin
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p
                   where p.oid = 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)'::regprocedure), chr(13), ''))
       <> '29c276503685c3bcf8a3c5a1375ef345'
     or (select p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)'::regprocedure)
     or has_function_privilege('anon', 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)', 'execute') then
    raise exception 'Garde de fin : enregistrer_parametres_des_cotisations n''a pas le corps ou les droits attendus.';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id:uuid:true,dossier_id:uuid:true,annee:integer:true,acre:boolean:false,taux_dentiste:numeric:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true,cumul_emploi_retraite:boolean:false,dispense_complementaire:boolean:false' then
    raise exception 'Garde de fin : les colonnes de parametres_des_cotisations ne sont pas celles que la migration laisse.';
  end if;
  if exists (select 1 from public.parametres_des_cotisations c where c.cumul_emploi_retraite is not null or c.dispense_complementaire is not null) then
    raise exception 'Garde de fin : une ligne porterait déjà une case du médecin.';
  end if;
end
$fin$;
