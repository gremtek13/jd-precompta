-- L'EXONÉRATION DES COTISATIONS DE RETRAITE 2025 D'UN MÉDECIN EN CUMUL EXERÇANT EN ZONE D'INTERVENTION PRIORITAIRE (ligne
-- 27.1 ; RET2-Q2, tranchée par le cabinet le 15/11/2026 : « (B) Une case de plus », contre la recommandation, qui était de le
-- dire seulement) — PRÉPARÉE le 15/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 15/11/2026 — RET2-Q2 : L'EXONÉRATION
-- DE 2025 EN ZONE D'INTERVENTION PRIORITAIRE, UNE CASE DE PLUS (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai :
-- supabase/essais/parametresDesCotisations.sql (étapes 9a à 9p, EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261115131100_retour_exoneration_en_zone_prioritaire.sql.
--
-- SOURCES (publiques). Loi n° 2025-199 du 28 février 2025 de financement de la sécurité sociale pour 2025, art. 6 (Légifrance,
-- JORFTEXT000051269481, en vigueur depuis le 1er mars 2025, non modifié au 15/11/2026) : I, les médecins exerçant dans une
-- zone « au sens de l'article L. 1434-4 du code de la santé publique » classée zone d'intervention prioritaire, « remplissant
-- les conditions prévues aux troisième à avant-dernier alinéas de l'article L. 643-6 du code de la sécurité sociale » (le
-- cumul intégral), sont exonérés « des cotisations d'assurance vieillesse mentionnées aux articles L. 642-1, L. 644-1,
-- L. 645-2 et L. 645-3 du même code » (le régime de base, le complémentaire, les prestations complémentaires de vieillesse)
-- « dues sur les revenus perçus en 2025 », sous un plafond de revenu fixé par décret ; II, ces périodes n'ouvrent aucun droit
-- nouveau au régime de base ; III, seulement pour les médecins « ayant liquidé leurs pensions de vieillesse personnelles avant
-- le premier jour du mois suivant la promulgation de la présente loi ». Décret n° 2025-810 du 13 août 2025 (JORFTEXT000052097133),
-- art. 1 : le plafond est de 70 000 euros. CARMF, « Guide du cumul retraite/activité libérale », juin 2026 (carmf.fr,
-- guide-cumul.pdf, p. 5, « Rappel • Exonération des cotisations de retraite 2025 ») : retraite CARMF prise au plus tard le
-- 1er janvier 2025, cumul intégral, exercice en ZIP (le site de l'ARS), revenus 2025 inférieurs à 70 000 € ; le régime de
-- base et le complémentaire exonérés (à titre provisoire en 2025, régularisés en 2026 sur les revenus définitifs, ou appliqués
-- en 2026 et en 2027), l'ASV exonéré en 2027 ; « si vos revenus 2025 sont ≥ 70 000 €, les cotisations resteront dues ».
-- L'invalidité-décès n'est pas dans l'article : un médecin en cumul n'y cotise plus (le même guide), ce que la case du cumul
-- dit déjà (RET-Q2).
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. Une colonne de `parametres_des_cotisations`, nulle tant que le cabinet ne l'a pas dite, d'un exercice :
--      `exoneration_zone_prioritaire` (le médecin est-il exonéré de ses cotisations de retraite sur les revenus de 2025 :
--      cumul intégral, retraite liquidée au plus tard le 1er janvier 2025, zone d'intervention prioritaire, revenus 2025 sous
--      70 000 €). L'application ne sait ni la zone, ni la date de la retraite, ni le revenu définitif : la case se DIT, elle ne
--      se déduit pas. Elle suit la ligne : figée avec l'exercice validé (la garde du gel compare la ligne entière, `to_jsonb`),
--      lue par le cabinet du dossier seul (la policy d'hier), au plan de sauvegarde avec elle.
--   2. Deux contraintes : la case ne se dit que pour l'exercice 2025 — la mesure ne vaut que pour les revenus de 2025
--      (`parametres_des_cotisations_exoneration_de_2025`) — ; dite « oui », elle demande le cumul dit « oui »
--      (`parametres_des_cotisations_exoneration_en_cumul`). Relevé sur la réplique au niveau de la production (227
--      migrations) : aucune ligne ne porte la colonne, qui naît nulle — rien n'est fautif.
--   3. `enregistrer_parametres_des_cotisations`, même signature, aux droits de l'appelant : les valeurs lues et saisies portent
--      les trois clés d'hier, les cinq de RET-Q2, ou les six — l'exonération comprise, comparée aux valeurs lues comme les
--      autres (40001) ; la même forme des deux côtés, sinon 22023. Sous les formes d'hier, l'exonération ne s'écrit ni ne se
--      compare : elle garde ce qu'elle est. Deux refus neufs, à leurs mots : l'exonération dite pour un autre exercice que 2025
--      (avant le verrou), et l'exonération « oui » sur une ligne dont le cumul ne l'est pas (après la lecture de la ligne,
--      sous toutes les formes : la forme à cinq clés qui retire le cumul d'un exercice exonéré se refuse aussi). Le reste au
--      caractère près : les refus, leur ordre, leurs mots, le verrou, ce qui ne change pas ne s'écrit pas.
--
-- CE QU'ELLE NE CHANGE PAS : `debuts_d_activite`, les contraintes d'hier, la policy, la garde du gel, aucune donnée (aucune
-- ligne ne reçoit la case). Une estimation d'hier reste celle d'hier tant que `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE`
-- (src/lib/parametresDesCotisations.ts) est baissé.
--
-- L'ORDRE : elle ne suppose que `cumul_et_dispense_du_medecin` (en production depuis le 15/11/2026), dont elle part : sa garde
-- de tête lit l'empreinte du corps de la fonction qu'elle remplace. La porte d'accès (`acces_avant_les_gardes`, en
-- production) couvre déjà cette table. D'abord la migration, puis le drapeau levé : l'écran levé envoie six clés, que la
-- fonction d'hier refuserait.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée ; `create or replace` d'une fonction, une colonne et deux contraintes
-- ajoutées. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL. Son retour retire la colonne, ses
-- contraintes et ce qu'elle porte, et rend la fonction d'hier : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE` se lève alors.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction d'écriture qui ne serait plus celle de la production (l'empreinte de
-- son corps, celle de `cumul_et_dispense_du_medecin`, les retours chariot d'un collage écartés) ; une garde du gel qui ne
-- comparerait plus la ligne entière ; une table qui n'aurait pas les deux cases du médecin.
do $garde$
begin
  if exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass
              and a.attname = 'exoneration_zone_prioritaire' and not a.attisdropped) then
    raise exception 'La migration exoneration_en_zone_prioritaire est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p
                           where p.oid = to_regprocedure('public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)')), ''), chr(13), ''))
       <> '29c276503685c3bcf8a3c5a1375ef345' then
    raise exception 'enregistrer_parametres_des_cotisations n''est plus celle de la production (empreinte attendue 29c27650…, celle de cumul_et_dispense_du_medecin) : la relire avant d''appliquer cette migration.';
  end if;
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p
                           where p.oid = to_regprocedure('public.garder_parametres_des_cotisations_valides()')), ''), chr(13), ''))
       <> 'bdc8847964b7473787c9af1310683c50' then
    raise exception 'La garde du gel des paramètres n''est plus celle de la production (empreinte attendue bdc88479…) : elle doit comparer la ligne entière, l''exonération comprise.';
  end if;
  if (select count(*) from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass
       and a.attname in ('cumul_emploi_retraite', 'dispense_complementaire') and not a.attisdropped) <> 2 then
    raise exception 'Les deux cases du médecin (cumul_et_dispense_du_medecin, RET-Q2) précèdent cette migration.';
  end if;
end
$garde$;

-- ══ 1. La case d'un exercice, et ses deux contraintes ══════════
alter table public.parametres_des_cotisations
  add column exoneration_zone_prioritaire boolean,
  add constraint parametres_des_cotisations_exoneration_de_2025 check (exoneration_zone_prioritaire is null or annee = 2025),
  add constraint parametres_des_cotisations_exoneration_en_cumul check (exoneration_zone_prioritaire is not true or cumul_emploi_retraite is true);

comment on column public.parametres_des_cotisations.exoneration_zone_prioritaire is
  'Un médecin : est-il exonéré de ses cotisations de retraite sur les revenus de 2025 — cumul intégral, retraite liquidée au plus tard le 1er janvier 2025, zone d''intervention prioritaire, revenus 2025 inférieurs à 70 000 € (loi n° 2025-199, art. 6 ; décret n° 2025-810) ? Dit par le cabinet, jamais déduit : l''application ne sait ni la zone, ni la date de la retraite. Exercice 2025 seulement ; « oui » demande le cumul. Nul : non dit (RET2-Q2).';

-- ══ 2. L'écriture d'un exercice : trois clés, cinq ou six ══════════
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
  -- RET2-Q2 : les six clés, l'exonération de 2025 en zone d'intervention prioritaire comprise.
  v_cles_de_l_exoneration constant text[] := array['acre', 'cumul_emploi_retraite', 'debut_activite', 'dispense_complementaire', 'exoneration_zone_prioritaire', 'taux_dentiste'];
  v_avec_les_cases boolean;
  v_avec_l_exoneration boolean;
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
  v_exoneration_lue boolean;
  v_exoneration_saisie boolean;
  v_debut_actuel date;
  v_acre_actuel boolean;
  v_taux_actuel numeric;
  v_cumul_actuel boolean;
  v_dispense_actuelle boolean;
  v_exoneration_actuelle boolean;
  v_n integer := 0;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.' using errcode = '42501';
  end if;
  if p_annee is null or jsonb_typeof(p_lus) is distinct from 'object' or jsonb_typeof(p_saisis) is distinct from 'object' then
    raise exception 'Les paramètres des cotisations partent mal formés : un exercice, les valeurs saisies et celles lues.'
      using errcode = '22023';
  end if;
  v_avec_l_exoneration := (select array_agg(k order by k collate "C") from jsonb_object_keys(p_saisis) k) is not distinct from v_cles_de_l_exoneration;
  v_avec_les_cases := v_avec_l_exoneration
    or (select array_agg(k order by k collate "C") from jsonb_object_keys(p_saisis) k) is not distinct from v_cles_du_medecin;
  foreach v_objet in array array[p_lus, p_saisis] loop
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_objet) k)
         is distinct from (case when v_avec_l_exoneration then v_cles_de_l_exoneration when v_avec_les_cases then v_cles_du_medecin else v_cles end)
       or jsonb_typeof(v_objet -> 'debut_activite') not in ('string', 'null')
       or jsonb_typeof(v_objet -> 'acre') not in ('boolean', 'null')
       or jsonb_typeof(v_objet -> 'taux_dentiste') not in ('number', 'null')
       or (v_avec_les_cases and (jsonb_typeof(v_objet -> 'cumul_emploi_retraite') not in ('boolean', 'null')
                                 or jsonb_typeof(v_objet -> 'dispense_complementaire') not in ('boolean', 'null')))
       or (v_avec_l_exoneration and jsonb_typeof(v_objet -> 'exoneration_zone_prioritaire') not in ('boolean', 'null'))
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
  v_exoneration_lue := (p_lus ->> 'exoneration_zone_prioritaire')::boolean;
  v_exoneration_saisie := (p_saisis ->> 'exoneration_zone_prioritaire')::boolean;
  -- RET2-Q2 : la mesure ne vaut que pour les revenus de 2025 (loi n° 2025-199, art. 6, I).
  if v_avec_l_exoneration and v_exoneration_saisie is not null and p_annee <> 2025 then
    raise exception 'L''exonération des cotisations de retraite d''un médecin en cumul exerçant en zone d''intervention prioritaire ne vaut que pour les revenus de 2025 : elle ne se dit pas pour l''exercice %.', p_annee
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('parametres_des_cotisations:' || p_dossier_id::text, 0));
  select d.date_debut into v_debut_actuel from public.debuts_d_activite d where d.dossier_id = p_dossier_id;
  select c.acre, c.taux_dentiste, c.cumul_emploi_retraite, c.dispense_complementaire, c.exoneration_zone_prioritaire
    into v_acre_actuel, v_taux_actuel, v_cumul_actuel, v_dispense_actuelle, v_exoneration_actuelle
    from public.parametres_des_cotisations c where c.dossier_id = p_dossier_id and c.annee = p_annee;
  if v_debut_actuel is distinct from v_debut_lu or v_acre_actuel is distinct from v_acre_lu
     or v_taux_actuel is distinct from v_taux_lu
     or (v_avec_les_cases and (v_cumul_actuel is distinct from v_cumul_lu or v_dispense_actuelle is distinct from v_dispense_lue))
     or (v_avec_l_exoneration and v_exoneration_actuelle is distinct from v_exoneration_lue) then
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
  -- RET2-Q2 : sous les formes à trois et cinq clés, l'exonération ne s'écrit pas non plus.
  if not v_avec_l_exoneration then
    v_exoneration_saisie := v_exoneration_actuelle;
  end if;
  -- RET2-Q2 : l'exonération dite « oui » demande le cumul dit « oui », sur la ligne telle qu'elle s'écrirait.
  if v_exoneration_saisie is true and v_cumul_saisi is not true then
    raise exception 'L''exonération de 2025 en zone d''intervention prioritaire ne vaut qu''en cumul emploi-retraite intégral : dis d''abord le cumul, ou retire l''exonération.'
      using errcode = '23514';
  end if;
  if v_acre_saisi is distinct from v_acre_actuel or v_taux_saisi is distinct from v_taux_actuel
     or v_cumul_saisi is distinct from v_cumul_actuel or v_dispense_saisie is distinct from v_dispense_actuelle
     or v_exoneration_saisie is distinct from v_exoneration_actuelle then
    insert into public.parametres_des_cotisations (dossier_id, annee, acre, taux_dentiste, cumul_emploi_retraite, dispense_complementaire,
                                                   exoneration_zone_prioritaire)
      values (p_dossier_id, p_annee, v_acre_saisi, v_taux_saisi, v_cumul_saisi, v_dispense_saisie, v_exoneration_saisie)
      on conflict on constraint parametres_des_cotisations_un_par_exercice do update
        set acre = excluded.acre, taux_dentiste = excluded.taux_dentiste, cumul_emploi_retraite = excluded.cumul_emploi_retraite,
            dispense_complementaire = excluded.dispense_complementaire,
            exoneration_zone_prioritaire = excluded.exoneration_zone_prioritaire, updated_at = now();
    v_n := v_n + 1;
  end if;
  return v_n;
end;
$$;

comment on function public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb) is
  'Le début d''activité du dossier et l''ACRE, le taux dentiste — sous la forme à cinq clés, le cumul emploi-retraite et la dispense du complémentaire d''un médecin ; sous celle à six, aussi l''exonération de 2025 en zone d''intervention prioritaire — d''un exercice, tout ou rien, contre les valeurs lues qu''ils remplacent (TNS-Q1, TNS-Q4, RET-Q2, RET2-Q2). Aux droits de l''appelant.';

-- ══ 3. La garde de fin ══════════
do $fin$
begin
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p
                   where p.oid = 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)'::regprocedure), chr(13), ''))
       <> 'f983fc220a8a5c429807b82ae1cd453b'
     or (select p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)'::regprocedure)
     or has_function_privilege('anon', 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.enregistrer_parametres_des_cotisations(uuid, integer, jsonb, jsonb)', 'execute') then
    raise exception 'Garde de fin : enregistrer_parametres_des_cotisations n''a pas le corps ou les droits attendus.';
  end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
        from pg_catalog.pg_attribute a where a.attrelid = 'public.parametres_des_cotisations'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'id:uuid:true,dossier_id:uuid:true,annee:integer:true,acre:boolean:false,taux_dentiste:numeric:false,created_at:timestamp with time zone:true,updated_at:timestamp with time zone:true,cumul_emploi_retraite:boolean:false,dispense_complementaire:boolean:false,exoneration_zone_prioritaire:boolean:false' then
    raise exception 'Garde de fin : les colonnes de parametres_des_cotisations ne sont pas celles que la migration laisse.';
  end if;
  if (select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname collate "C")
        from pg_catalog.pg_constraint c
       where c.conrelid = 'public.parametres_des_cotisations'::regclass and c.conname like 'parametres_des_cotisations_exoneration%')
     is distinct from 'parametres_des_cotisations_exoneration_de_2025 CHECK (((exoneration_zone_prioritaire IS NULL) OR (annee = 2025))) ; '
                   || 'parametres_des_cotisations_exoneration_en_cumul CHECK (((exoneration_zone_prioritaire IS NOT TRUE) OR (cumul_emploi_retraite IS TRUE)))' then
    raise exception 'Garde de fin : les deux contraintes de l''exonération ne sont pas celles que la migration pose.';
  end if;
  if exists (select 1 from public.parametres_des_cotisations c where c.exoneration_zone_prioritaire is not null) then
    raise exception 'Garde de fin : une ligne porterait déjà l''exonération.';
  end if;
end
$fin$;
